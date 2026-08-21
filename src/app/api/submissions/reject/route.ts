import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Same enforcement point as approve — see that route's comment.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: caller } = await supabase
      .from("system_users")
      .select("id, role")
      .eq("email", user.email!.toLowerCase())
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();

    if (!caller || (caller.role !== "owner" && caller.role !== "manager")) {
      return NextResponse.json({ error: "Only owners and managers can reject registrations" }, { status: 403 });
    }

    const { submissionId, reason } = await req.json();
    if (!submissionId || !reason?.trim()) {
      return NextResponse.json({ error: "Missing submissionId or reason" }, { status: 400 });
    }

    const admin = getServiceClient();

    const { data: sub, error: subFetchError } = await admin
      .from("submissions")
      .select("id, full_name, status")
      .eq("id", submissionId)
      .is("deleted_at", null)
      .single();
    if (subFetchError || !sub) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    if (sub.status !== "pending") return NextResponse.json({ error: `Already ${sub.status}` }, { status: 409 });

    const { error: subError } = await admin
      .from("submissions")
      .update({ status: "rejected", rejection_reason: reason, reviewed_at: new Date().toISOString(), reviewed_by: caller.id })
      .eq("id", submissionId);
    if (subError) return NextResponse.json({ error: subError.message }, { status: 500 });

    await admin.from("activity_logs").insert({
      user_id: caller.id,
      action: "rejected_submission",
      entity_type: "submission",
      entity_id: submissionId,
      description: `Rejected registration for ${sub.full_name}. Reason: ${reason}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Reject Submission Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
