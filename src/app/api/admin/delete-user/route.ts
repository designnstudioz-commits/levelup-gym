import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: caller } = await supabase
      .from("system_users")
      .select("id, role")
      .eq("email", user.email!)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();

    if (!caller || caller.role !== "owner") {
      return NextResponse.json({ error: "Only owners can manage users" }, { status: 403 });
    }

    const { userId, userName } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    // Prevent self-deletion
    if (userId === caller.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    const admin = getServiceClient();

    // Soft-delete from system_users
    const { error: dbError } = await admin
      .from("system_users")
      .update({ deleted_at: new Date().toISOString(), status: "inactive" })
      .eq("id", userId);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // Disable auth user (non-fatal if it fails)
    await admin.auth.admin.deleteUser(userId).catch(() => {});

    // Activity log
    await supabase.from("activity_logs").insert({
      user_id: caller.id,
      action: "deleted_system_user",
      entity_type: "system_user",
      entity_id: userId,
      description: `${user.email} deleted system user ${userName ?? userId}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Delete User Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
