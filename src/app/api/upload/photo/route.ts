import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sniffImageType, IMAGE_EXTENSION, checkRateLimit, clientIpFrom, generateStoragePath,
} from "@/lib/uploadSecurity";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX_SIZE = 5 * 1024 * 1024;

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
      return NextResponse.json({ error: "Image must be under 5 MB" }, { status: 400 });
    }

    const sniffed = await sniffImageType(file);
    if (!sniffed) {
      return NextResponse.json({ error: "Only JPEG, PNG, WEBP or HEIC images are allowed" }, { status: 400 });
    }

    const supabase = getServiceClient();
    // Path is entirely server-generated — the client's filename/type are
    // never used to construct it, so there is no way to influence the
    // storage path or force an unsafe extension.
    const path = generateStoragePath("members", IMAGE_EXTENSION[sniffed]);

    const { error } = await supabase.storage
      .from("member-photos")
      .upload(path, file, { contentType: `image/${sniffed === "jpeg" ? "jpeg" : sniffed}`, upsert: false });

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
