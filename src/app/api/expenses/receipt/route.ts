import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  sniffImageType,
  sniffIsPdf,
  generateStoragePath,
  checkRateLimit,
  clientIpFrom,
} from "@/lib/uploadSecurity";
import { processDocumentImage, ImageProcessingError } from "@/lib/imageProcessing";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_CREATE_ROLES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const BUCKET = "expense-receipts";
const MAX_SIZE = 20 * 1024 * 1024; // source cap; images are re-encoded smaller

// POST /api/expenses/receipt — upload one expense receipt.
//
// Requires a signed-in front-desk session, unlike the older /api/upload/*
// routes which were built before that was enforced. The bucket is PRIVATE:
// a receipt can carry a supplier invoice or bank details, so it is never
// served publicly — the page fetches a short-lived signed URL when someone
// actually opens one.
//
// File type is decided by MAGIC BYTES, never the client-supplied name or
// MIME. Storage paths are generated server-side, so a caller cannot choose
// where the object lands or overwrite an existing one (upsert: false).
export async function POST(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const ip = clientIpFrom(req);
    if (!checkRateLimit(`expense-receipt:${ip}`, 20, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "File must be under 20 MB" }, { status: 400 });

    const sniffedImage = await sniffImageType(file);
    const isPdf = sniffedImage ? false : await sniffIsPdf(file);
    if (!sniffedImage && !isPdf) {
      return NextResponse.json({ error: "Only PDF, JPEG, PNG, WEBP or HEIC receipts are allowed" }, { status: 400 });
    }

    // PDFs pass through untouched; photographed receipts are orientation-
    // corrected and gently downscaled, same treatment as member documents.
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
          return NextResponse.json(
            { error: "This file could not be processed as an image. Please try a different file." },
            { status: 400 }
          );
        }
        throw err;
      }
    }

    const supabase = getServiceClient();
    const path = generateStoragePath("receipts", ext);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, uploadBody, { contentType, upsert: false });

    if (error) {
      console.error("[Expense Receipt Upload]", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Only the exact path just created is returned. Nothing here lists or
    // deletes by prefix — see CLAUDE.md rule 11 and the 45-photo incident.
    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error("[Expense Receipt POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/expenses/receipt?path=... — short-lived signed URL for one receipt.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const path = new URL(req.url).searchParams.get("path");
    if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });

    // The path must belong to this bucket's generated namespace. Without
    // this a caller could pass an arbitrary key and have it signed.
    if (!path.startsWith("receipts/") || path.includes("..")) {
      return NextResponse.json({ error: "Invalid receipt path" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error || !data) {
      return NextResponse.json({ error: "Could not open receipt" }, { status: 404 });
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (err) {
    console.error("[Expense Receipt GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
