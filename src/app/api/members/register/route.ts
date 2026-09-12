import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const ALLOWED_ROLES = ["owner", "manager", "receptionist"];

/**
 * POST /api/members/register
 *
 * The single entry point for the staff "Add Member" flow, replacing what
 * used to be several sequential client-side inserts (member row, activity
 * log, commission, admission fee_payments, membership fee_payments, more
 * activity logs). That sequence is exactly what produced a real incident:
 * the member insert succeeded, a later fee_payments insert failed, the
 * whole thing was reported to the user as failed, and the retry created a
 * genuine duplicate member with no fee ever recorded (Mansoor,
 * LUM-2026-0458/0459; the same thing happened earlier and went unnoticed —
 * Moazen Bilal, LUM-2026-0288).
 *
 * This route does none of the actual writing itself — it resolves and
 * authorizes the caller, then hands the whole payload to
 * register_member_with_payment(), a single atomic Postgres function
 * (see 20260913150000_register_member_with_payment.sql) that either
 * commits member + payment + logs together or rolls back all of it. The
 * actor id is resolved from the verified session here, never trusted from
 * the request body.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: caller } = await supabase
      .from("system_users")
      .select("id, role")
      .eq("email", user.email.toLowerCase())
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();

    if (!caller || !ALLOWED_ROLES.includes(caller.role)) {
      return NextResponse.json({ error: "Only owner/manager/receptionist can add members" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { idempotency_key, member, admission_payment, membership_payment, commission } = body as {
      idempotency_key?: string;
      member?: Record<string, unknown>;
      admission_payment?: Record<string, unknown> | null;
      membership_payment?: Record<string, unknown> | null;
      commission?: Record<string, unknown> | null;
    };

    if (!member || typeof member !== "object") {
      return NextResponse.json({ error: "member details are required" }, { status: 400 });
    }
    if (!idempotency_key) {
      return NextResponse.json({ error: "idempotency_key is required" }, { status: 400 });
    }

    const admin = getServiceClient();
    const { data, error } = await admin.rpc("register_member_with_payment", {
      payload: {
        idempotency_key,
        actor_id: caller.id,
        member,
        admission_payment: admission_payment ?? null,
        membership_payment: membership_payment ?? null,
        commission: commission ?? null,
      },
    });

    if (error) {
      console.error("[Member Register Error]", error);
      // The function's own RAISE EXCEPTION messages are already written to
      // be safe, specific, and user-facing (e.g. "membership payment lines
      // do not reconcile with amount collected") — passed through as-is
      // rather than replaced with a generic message, so staff actually
      // learn what to fix instead of just "try again" (which is the exact
      // pattern that caused the duplicate in the first place).
      return NextResponse.json({ error: error.message || "Registration failed" }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[Member Register Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
