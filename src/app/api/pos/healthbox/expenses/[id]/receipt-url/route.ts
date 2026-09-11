import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Mints a short-lived signed URL for one receipt file. The bucket is
 *  private, so this route IS the access control — owner/manager may view
 *  any receipt, healthbox_staff only a receipt on their own expense.
 *  ?path= must be one of the expense's own attachment_urls entries, so a
 *  caller can't probe arbitrary storage paths through this endpoint. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });

  const admin = getServiceClient();
  const { data: expense } = await admin.from("pos_healthbox_expenses").select("submitted_by, attachment_urls").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

  if (!POS_ADMIN_ROLES.includes(caller.role) && expense.submitted_by !== caller.id) {
    return NextResponse.json({ error: "You cannot view this receipt" }, { status: 403 });
  }
  if (!Array.isArray(expense.attachment_urls) || !expense.attachment_urls.includes(path)) {
    return NextResponse.json({ error: "That file is not attached to this expense" }, { status: 400 });
  }

  const { data, error } = await admin.storage.from("pos-healthbox-receipts").createSignedUrl(path, 60);
  if (error || !data) {
    console.error("[HealthBox receipt signed URL]", error);
    return NextResponse.json({ error: "Could not open this receipt" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
