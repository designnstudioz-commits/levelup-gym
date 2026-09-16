import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { EDITABLE_STATUSES } from "@/lib/pos/healthboxExpenses";
import { sniffImageType, sniffIsPdf, generateStoragePath } from "@/lib/uploadSecurity";
import { processDocumentImage, ImageProcessingError } from "@/lib/imageProcessing";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Source cap, not stored size. A receipt is a financial document — gently
// processed like other documents (see /api/upload/document), never
// squeezed to a target byte size, so a large well-lit photo of a receipt
// still needs headroom on the way in.
const MAX_SIZE = 20 * 1024 * 1024;

/** Uploads a receipt/proof file to the PRIVATE pos-healthbox-receipts
 *  bucket and links it to the expense. Never returns a public URL — the
 *  stored value is the object's storage path, resolved to a short-lived
 *  signed URL only through GET .../receipt-url (see that route). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: expense } = await admin.from("pos_healthbox_expenses").select("id, title, submitted_by, status, attachment_urls").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

  const isManager = POS_ADMIN_ROLES.includes(caller.role);
  if (!isManager && expense.submitted_by !== caller.id) {
    return NextResponse.json({ error: "You can only attach a receipt to your own expense" }, { status: 403 });
  }
  if (!EDITABLE_STATUSES.includes(expense.status)) {
    return NextResponse.json({ error: `An expense that is ${expense.status} can no longer have receipts changed` }, { status: 400 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  const replace = formData?.get("replace") === "true";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "File must be under 20 MB" }, { status: 400 });

  const sniffedImage = await sniffImageType(file);
  const isPdf = sniffedImage ? false : await sniffIsPdf(file);
  if (!sniffedImage && !isPdf) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP or PDF receipts are allowed" }, { status: 400 });
  }

  let uploadBody: Buffer | File = file;
  let ext = sniffedImage ? "webp" : "pdf";
  let contentType = sniffedImage ? "image/webp" : "application/pdf";

  if (sniffedImage) {
    const original = Buffer.from(await file.arrayBuffer());
    try {
      const result = await processDocumentImage(original);
      uploadBody = result.buffer;
      ext = result.ext;
      contentType = result.contentType;
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        console.error("[HealthBox receipt upload] processing failed", err);
        return NextResponse.json({ error: "This file could not be processed as an image. Please try a different file." }, { status: 400 });
      }
      throw err;
    }
  }

  const path = generateStoragePath(`expenses/${id}`, ext);

  const { error: uploadError } = await admin.storage.from("pos-healthbox-receipts").upload(path, uploadBody, { contentType, upsert: false });
  if (uploadError) {
    console.error("[HealthBox receipt upload]", uploadError);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const existingPaths = Array.isArray(expense.attachment_urls) ? expense.attachment_urls : [];
  const newPaths = replace ? [path] : [...existingPaths, path];

  const { error: updateError } = await admin.from("pos_healthbox_expenses").update({ attachment_urls: newPaths, updated_at: new Date().toISOString() }).eq("id", id);
  if (updateError) {
    console.error("[HealthBox receipt link]", updateError);
    return NextResponse.json({ error: "Uploaded but could not link the receipt" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: replace ? "replaced_healthbox_expense_receipt" : "uploaded_healthbox_expense_receipt",
    entityType: "pos_healthbox_expense",
    entityId: id,
    description: `${caller.fullName} ${replace ? "replaced the receipt on" : "uploaded a receipt for"} HealthBox expense "${expense.title}"`,
  });

  return NextResponse.json({ path, attachmentPaths: newPaths });
}
