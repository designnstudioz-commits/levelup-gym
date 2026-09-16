import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES } from "@/lib/pos/permissions";
import { sniffImageType, generateStoragePath } from "@/lib/uploadSecurity";
import { processProductImage, ImageProcessingError } from "@/lib/imageProcessing";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Source cap, not stored size — see /api/upload/photo for the same reasoning.
const MAX_SIZE = 20 * 1024 * 1024;

/**
 * Product image upload, to the pos-products bucket. Requires a real POS
 * session (requirePosUser) — unlike the public registration uploads, this
 * one can and does require auth. Same content-sniffing / server-generated
 * path hardening as the member-photo/document routes (brought in line
 * with that work while adding the optimization pipeline here, per the
 * security audit's instruction that image processing must not weaken any
 * existing upload control), then resized/compressed to a consistent
 * ≤1200px WebP product image.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Image must be under 20 MB" }, { status: 400 });

  const sniffed = await sniffImageType(file);
  if (!sniffed) {
    return NextResponse.json({ error: "Only JPEG, PNG, WEBP or HEIC images are allowed" }, { status: 400 });
  }

  const original = Buffer.from(await file.arrayBuffer());
  let result;
  try {
    result = await processProductImage(original);
  } catch (err) {
    console.error("[POS product image upload] processing failed", err instanceof ImageProcessingError ? err.message : err);
    return NextResponse.json({ error: "This file could not be processed as an image. Please try a different photo." }, { status: 400 });
  }

  const admin = getServiceClient();
  const path = generateStoragePath("products", result.ext);

  const { error } = await admin.storage.from("pos-products").upload(path, result.buffer, { contentType: result.contentType, upsert: false });
  if (error) {
    console.error("[POS product image upload]", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from("pos-products").getPublicUrl(path);
  return NextResponse.json({ url: publicUrl });
}
