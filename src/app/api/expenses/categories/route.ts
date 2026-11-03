import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_VIEW_ROLES, EXPENSE_CREATE_ROLES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Expense categories — the list the owner maintains himself.
//
// Owner-only throughout, matching the rest of the module. Writes go through
// the service client AFTER the session has been checked here, which is the
// same pattern the other expense routes use.

const MAX_LABEL = 40;

/** What gets written into expenses.expense_head. Derived from the label once,
 *  at creation, and then never changed — bills store this string, so editing
 *  it afterwards would detach them from their category. Renames change the
 *  label instead, which nothing stores. */
function valueFromLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

/** GET — the live list, in display order. */
export async function GET() {
  try {
    const auth = await requireStaff(EXPENSE_VIEW_ROLES);
    if (!auth.ok) return auth.response;

    const { data, error } = await getServiceClient()
      .from("expense_categories")
      .select("id, value, label, sort_order, is_default")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });

    if (error) {
      console.error("[ExpenseCategories GET]", error);
      return NextResponse.json({ error: "Could not load categories" }, { status: 500 });
    }
    return NextResponse.json({ categories: data ?? [] });
  } catch (err) {
    console.error("[ExpenseCategories GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST — add one. Body: { label } */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    const label = typeof body?.label === "string" ? body.label.trim() : "";

    if (!label) {
      return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
    }
    if (label.length > MAX_LABEL) {
      return NextResponse.json({ error: `Keep the name under ${MAX_LABEL} characters` }, { status: 400 });
    }

    const admin = getServiceClient();
    const value = valueFromLabel(label);

    // Checked here for a usable message; the partial unique index on
    // lower(value) is what actually guarantees it against two people adding
    // the same name at once.
    const { data: clash } = await admin
      .from("expense_categories")
      .select("id, label, deleted_at")
      .ilike("value", value)
      .maybeSingle();

    if (clash && !clash.deleted_at) {
      return NextResponse.json({ error: `"${clash.label}" already exists` }, { status: 409 });
    }

    // An archived category coming back keeps its id and its history rather
    // than becoming a second row with the same name.
    if (clash?.deleted_at) {
      const { data, error } = await admin
        .from("expense_categories")
        .update({ deleted_at: null, label, updated_at: new Date().toISOString() })
        .eq("id", clash.id)
        .select("id, value, label, sort_order, is_default")
        .single();

      if (error) {
        console.error("[ExpenseCategories POST restore]", error);
        return NextResponse.json({ error: "Could not restore that category" }, { status: 500 });
      }
      await admin.from("activity_logs").insert({
        user_id: auth.caller.id,
        action: "restored_expense_category",
        entity_type: "expense_category",
        entity_id: data.id,
        description: `Restored expense category "${label}"`,
      });
      return NextResponse.json({ category: data, restored: true });
    }

    // New categories sort after the ten defaults, in the order they are added.
    const { data: last } = await admin
      .from("expense_categories")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await admin
      .from("expense_categories")
      .insert({
        value,
        label,
        sort_order: (last?.sort_order ?? 100) + 10,
        is_default: false,
        created_by: auth.caller.id,
      })
      .select("id, value, label, sort_order, is_default")
      .single();

    if (error) {
      // 23505 is the unique index firing — someone else added the same name
      // between the check above and this insert.
      if (error.code === "23505") {
        return NextResponse.json({ error: "That category already exists" }, { status: 409 });
      }
      console.error("[ExpenseCategories POST]", error);
      return NextResponse.json({ error: "Could not add that category" }, { status: 500 });
    }

    await admin.from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "added_expense_category",
      entity_type: "expense_category",
      entity_id: data.id,
      description: `Added expense category "${label}"`,
    });

    return NextResponse.json({ category: data });
  } catch (err) {
    console.error("[ExpenseCategories POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH — rename. Body: { id, label } */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const label = typeof body?.label === "string" ? body.label.trim() : "";

    if (!id) return NextResponse.json({ error: "Which category?" }, { status: 400 });
    if (!label) return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
    if (label.length > MAX_LABEL) {
      return NextResponse.json({ error: `Keep the name under ${MAX_LABEL} characters` }, { status: 400 });
    }

    // Only the label moves. `value` is what bills store, so it is left alone
    // deliberately — see valueFromLabel above.
    const { data, error } = await getServiceClient()
      .from("expense_categories")
      .update({ label, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id, value, label, sort_order, is_default")
      .single();

    if (error || !data) {
      console.error("[ExpenseCategories PATCH]", error);
      return NextResponse.json({ error: "Could not rename that category" }, { status: 500 });
    }

    await getServiceClient().from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "renamed_expense_category",
      entity_type: "expense_category",
      entity_id: data.id,
      description: `Renamed expense category to "${label}"`,
    });

    return NextResponse.json({ category: data });
  } catch (err) {
    console.error("[ExpenseCategories PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE — archive. Body: { id }
 *
 *  Archived, never removed: bills already filed under it keep their
 *  expense_head text and keep displaying this label. It simply stops being
 *  offered on the form. */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Which category?" }, { status: 400 });

    const admin = getServiceClient();

    // Refuse to empty the list entirely — the Add Bill form has a required
    // category field and would become unusable.
    const { count } = await admin
      .from("expense_categories")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "This is the last category — add another before removing this one" },
        { status: 409 }
      );
    }

    const { data, error } = await admin
      .from("expense_categories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id, label")
      .single();

    if (error || !data) {
      console.error("[ExpenseCategories DELETE]", error);
      return NextResponse.json({ error: "Could not remove that category" }, { status: 500 });
    }

    // How many bills still carry it, so the UI can say so plainly.
    const { count: used } = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("expense_head", data.label)
      .is("deleted_at", null);

    await admin.from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "archived_expense_category",
      entity_type: "expense_category",
      entity_id: data.id,
      description: `Archived expense category "${data.label}"`,
    });

    return NextResponse.json({ success: true, archived: data.label, billsAffected: used ?? 0 });
  } catch (err) {
    console.error("[ExpenseCategories DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
