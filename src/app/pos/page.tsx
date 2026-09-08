import { Monitor, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PosTopBar } from "@/components/pos/PosTopBar";

/**
 * Stage A placeholder for the cashier terminal.
 *
 * The real three-zone terminal — department rail, product grid, order panel
 * — is Stage B. What this page proves, and what Stage A is accountable for,
 * is that the plumbing underneath it is correct: the route is
 * authenticated, the role gate admits exactly the right roles, the shell
 * renders without the dashboard sidebar, and the seeded departments are
 * readable.
 *
 * It is a server component so the department read happens before paint.
 */
export default async function PosTerminalPage() {
  const supabase = await createClient();

  const { data: departments } = await supabase
    .from("pos_departments")
    .select("id, name, slug, financial_owner, sort_order")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("sort_order");

  const seeded = departments ?? [];

  return (
    <>
      <PosTopBar title="Cashier Terminal" />

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white border border-[#E4E4DE] rounded-xl p-8">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                <Monitor className="w-6 h-6 text-[#F06418]" />
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
                  Terminal foundations ready
                </h2>
                <p className="text-sm text-[#4A4A44] mt-1 max-w-prose">
                  Stage A is in place: the POS route is authenticated and role-gated,
                  the cashier and HealthBox roles exist, and the catalogue schema is
                  live. The full ordering terminal arrives in Stage B.
                </p>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-[#E4E4DE]">
              <h3 className="text-xs font-semibold text-[#7A7A72] uppercase tracking-wider mb-3">
                Departments
              </h3>

              {seeded.length === 0 ? (
                <p className="text-sm text-[#7A7A72]">
                  No departments found. Run the Phase 3 migrations, including
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-[#F1EFEA] text-[#1A1A16] text-xs">
                    20260909100700_pos_seed.sql
                  </code>
                  , in the Supabase SQL editor.
                </p>
              ) : (
                <ul className="space-y-2">
                  {seeded.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border border-[#E4E4DE]"
                    >
                      <span className="flex items-center gap-2.5 text-sm font-semibold text-[#1A1A16]">
                        <CheckCircle2 className="w-4 h-4 text-[#F06418]" />
                        {d.name}
                      </span>
                      <span
                        className={
                          d.financial_owner === "healthbox"
                            ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]"
                            : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200"
                        }
                      >
                        {d.financial_owner === "healthbox" ? "HealthBox" : "Level Up"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
