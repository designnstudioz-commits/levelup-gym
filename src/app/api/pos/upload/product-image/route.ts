import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Product image upload, to the pos-products bucket.
 *
 * Unlike the existing /api/upload/photo route (member photos), which has
 * no auth check at all and accepts any POST from anyone using the
 * service-role key — a pre-existing gap flagged in the Phase 3 audit, not
 * something Phase D copies — this route requires a real POS session
 * before it will touch storage at all.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only images are allowed" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Image must be under 5 MB" }, { status: 400 });

  const admin = getServiceClient();
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await admin.storage.from("pos-products").upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[POS product image upload]", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from("pos-products").getPublicUrl(path);
  return NextResponse.json({ url: publicUrl });
}
