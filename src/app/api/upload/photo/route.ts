import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sniffImageType, checkRateLimit, clientIpFrom, generateStoragePath,
} from "@/lib/uploadSecurity";
import { processProfileImage, ImageProcessingError } from "@/lib/imageProcessing";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Raw phone/camera photos routinely land in the 8-12MB range — this is the
// SOURCE size cap, not the stored size (the optimization pipeline brings
// the stored result down to ~100-250KB regardless of how large the source
// was). 20MB gives real photos headroom while still bounding the request
// body; sharp's own default ~268-megapixel decompression-bomb guard is the
// backstop against a byte-small-but-pixel-enormous crafted file.
const MAX_SIZE = 20 * 1024 * 1024;

// Reachable anonymously — the public registration form uploads a photo
// before any account exists, so this cannot require a session (see the
// security audit note in CLAUDE.md history). Hardened instead: real
// magic-byte content sniffing (never trust client-supplied MIME/filename),
// server-generated storage paths only, and a best-effort per-IP throttle.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIpFrom(req);
    if (!checkRateLimit(`photo:${ip}`, 10, 10 * 60 * 1000)) {
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
      return NextResponse.json({ error: "Image must be under 20 MB" }, { status: 400 });
    }

    const sniffed = await sniffImageType(file);
    if (!sniffed) {
      return NextResponse.json({ error: "Only JPEG, PNG, WEBP or HEIC images are allowed" }, { status: 400 });
    }

    // Resize/compress to a consistent, small application image (~1024px,
    // ~100-250KB WebP) — same pipeline for both public registration and
    // the dashboard member-photo update, since both call this one route.
    // If sharp can't process this file, the upload is REJECTED — it must
    // never be stored as its original, unoptimized multi-megabyte form.
    const original = Buffer.from(await file.arrayBuffer());
    let result;
    try {
      result = await processProfileImage(original);
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        console.error("[Photo Upload Error] processing failed", err);
        return NextResponse.json({ error: "This file could not be processed as an image. Please try a different photo." }, { status: 400 });
      }
      throw err;
    }

    const supabase = getServiceClient();
    // Path is entirely server-generated — the client's filename/type are
    // never used to construct it, so there is no way to influence the
    // storage path or force an unsafe extension.
    const path = generateStoragePath("members", result.ext);

    const { error } = await supabase.storage
      .from("member-photos")
      .upload(path, result.buffer, { contentType: result.contentType, upsert: false });

    if (error) {
      console.error("[Photo Upload Error]", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage
      .from("member-photos")
      .getPublicUrl(path);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[Photo Upload Error]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
