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
    // Verify the caller is an owner
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

    const body = await req.json();
    const { email, password, full_name, role, staff_id } = body;

    if (!email || !password || !full_name || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getServiceClient();

    // Create auth user
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const authUserId = authData.user.id;

    // Insert system_users row
    const { error: dbError } = await admin
      .from("system_users")
      .insert({
        id: authUserId,
        email,
        full_name,
        role,
        status: "active",
        staff_id: staff_id ?? null,
      });

    if (dbError) {
      // Rollback: delete the auth user
      await admin.auth.admin.deleteUser(authUserId);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // Activity log
    await supabase.from("activity_logs").insert({
      user_id: caller.id,
      action: "added_system_user",
      entity_type: "system_user",
      entity_id: authUserId,
      description: `${user.email} added new system user ${full_name} (${role})`,
    });

    return NextResponse.json({ success: true, userId: authUserId });
  } catch (err) {
    console.error("[Create User Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
