import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/pdf",
];

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only PDF or image files are allowed" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 5 MB" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const ext = file.name.split(".").pop() ?? "pdf";
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
    const path = `submissions/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

    const { error } = await supabase.storage
      .from("member-docs")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage
      .from("member-docs")
      .getPublicUrl(path);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[Document Upload Error]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
