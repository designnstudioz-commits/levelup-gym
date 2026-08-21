import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { generateMembershipNo } from "@/lib/utils";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Approving a submission creates a real member record and a membership
// number — previously this ran as a direct browser-side mutation with no
// role check at all (any authenticated role could call it). This route is
// the actual enforcement point, mirroring src/app/api/admin/create-user.
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
      return NextResponse.json({ error: "Only owners and managers can approve registrations" }, { status: 403 });
    }

    const { submissionId } = await req.json();
    if (!submissionId) return NextResponse.json({ error: "Missing submissionId" }, { status: 400 });

    const admin = getServiceClient();

    const { data: sub, error: subFetchError } = await admin
      .from("submissions")
      .select("*")
      .eq("id", submissionId)
      .is("deleted_at", null)
      .single();
    if (subFetchError || !sub) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    if (sub.status !== "pending") return NextResponse.json({ error: `Already ${sub.status}` }, { status: 409 });

    const membershipNo = await generateMembershipNo(sub.gender, "member", admin);

    const { data: newMember, error: memberError } = await admin.from("members").insert({
      submission_id: sub.id,
      membership_no: membershipNo,
      full_name: sub.full_name,
      secondary_name: sub.secondary_name,
      dob: sub.dob,
      age: sub.age,
      gender: sub.gender,
      marital_status: sub.marital_status,
      phone: sub.phone,
      whatsapp: sub.whatsapp,
      email: sub.email,
      cnic: sub.cnic,
      address: sub.address,
      blood_group: sub.blood_group,
      vaccinated: sub.vaccinated,
      height: sub.height,
      weight: sub.weight,
      medical_notes: sub.medical_notes,
      emergency_name: sub.emergency_name,
      emergency_phone: sub.emergency_phone,
      photo_url: sub.photo_url,
      package_id: sub.package_id,
      trainer_id: sub.trainer_id,
      joining_date: sub.joining_date,
      // submissions has no separate Membership Start Date field to source
      // a different value from, so this defaults to Joining Date — the
      // normal case per the business rule (a manager can still adjust it
      // afterward on the member's profile).
      membership_start_date: sub.joining_date,
      expiry_date: sub.expiry_date,
      admission_fee: sub.admission_fee,
      monthly_fee: sub.monthly_fee,
      status: "active",
    }).select("id").single();

    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });

    const { error: subError } = await admin
      .from("submissions")
      .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: caller.id })
      .eq("id", sub.id);
    if (subError) return NextResponse.json({ error: subError.message }, { status: 500 });

    await admin.from("activity_logs").insert({
      user_id: caller.id,
      action: "approved_submission",
      entity_type: "submission",
      entity_id: sub.id,
      description: `Approved registration for ${sub.full_name} — Membership ${membershipNo}`,
      metadata: { membership_no: membershipNo },
    });

    return NextResponse.json({ success: true, memberId: newMember.id, membershipNo });
  } catch (err) {
    console.error("[Approve Submission Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
