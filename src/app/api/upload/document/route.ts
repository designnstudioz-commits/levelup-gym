import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sniffImageType, sniffIsPdf, checkRateLimit, clientIpFrom, generateStoragePath,
} from "@/lib/uploadSecurity";
import { processDocumentImage, ImageProcessingError } from "@/lib/imageProcessing";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Same reasoning as /api/upload/photo: this is a SOURCE size cap, not the
// stored size — image documents get gently downsized/re-encoded, PDFs pass
// through untouched. 20MB accommodates a real phone photo of an ID card
// or a multi-page scanned PDF without rejecting the user.
const MAX_SIZE = 20 * 1024 * 1024;

// Reachable anonymously — public registration's document step (ID card,
// medical certificates) uploads before any account exists, so this cannot
// require a session. Hardened the same way as /api/upload/photo: real
// magic-byte content sniffing, server-generated storage paths only
// (the original filename is never used, even sanitized — it added nothing
// and only widened the attack surface), and a best-effort per-IP throttle.
// The destination bucket (member-docs) was converted to private in the
// same change — see 20260913100200_member_docs_private.sql.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIpFrom(req);
    if (!checkRateLimit(`document:${ip}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 20 MB" }, { status: 400 });
    }

    const sniffedImage = await sniffImageType(file);
    const isPdf = sniffedImage ? false : await sniffIsPdf(file);

    if (!sniffedImage && !isPdf) {
      return NextResponse.json({ error: "Only PDF, JPEG, PNG, WEBP or HEIC files are allowed" }, { status: 400 });
    }

    // PDFs pass through completely untouched — no reason to transform
    // them, and text readability matters more than file size for
    // documents in general. Image documents (photographed CNIC/ID/medical
    // paperwork) get EXIF-orientation-corrected and only down-scaled if
    // they're larger than needed for readable text — a much gentler pass
    // than the profile-photo pipeline, with no target-byte-size squeeze.
    // A genuinely undecodable image is REJECTED, not stored as-is — a
    // corrupt file must never be accepted as if it were a valid document.
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
          console.error("[Document Upload Error] processing failed", err);
          return NextResponse.json({ error: "This file could not be processed as an image. Please try a different file." }, { status: 400 });
        }
        throw err;
      }
    }

    const supabase = getServiceClient();
    const path = generateStoragePath("submissions", ext);

    const { error } = await supabase.storage
      .from("member-docs")
      .upload(path, uploadBody, { contentType, upsert: false });

    if (error) {
      console.error("[Document Upload Error]", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // member-docs is a private bucket — this signed URL is short-lived and
    // scoped to this one upload, only ever returned to the uploader who
    // just created it in this same request.
    const { data: signed, error: signError } = await supabase.storage
      .from("member-docs")
      .createSignedUrl(path, 60 * 60);

    if (signError || !signed) {
      console.error("[Document Upload Sign Error]", signError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl, path });
  } catch (err) {
    console.error("[Document Upload Error]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
