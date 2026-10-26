"use client";

import { format, parseISO } from "date-fns";
import { formatPKR, formatDate } from "@/lib/utils";
import {
  amountAsOf, paidAgainst, outstandingOn, expenseStatus,
  type ExpenseBillRow,
} from "@/lib/expenses";

// The month's expenses as a sheet of paper, for checking against receipts by
// hand. On screen it does not exist; it only appears to the printer.
//
// It is NOT the on-screen table restyled. That table is paginated, so printing
// it would silently produce one page of a longer month — the single most
// likely way a printed tally could come out wrong. This renders every row it
// is given, in one pass, with no page size.
//
// Each row ends in an empty box. That is the point of the exercise: the sheet
// is for ticking off against receipts, so the tick needs somewhere to go.
export function ExpensePrintSheet({
  monthStart,
  monthEnd,
  bills,
  filterNote,
  configured,
  opening,
  income,
  paidOut,
  closing,
  outstanding,
}: {
  monthStart: string;
  monthEnd: string;
  bills: ExpenseBillRow[];
  /** Describes any active filter, so a partial list can never look complete. */
  filterNote: string | null;
  configured: boolean;
  opening: number;
  income: number;
  paidOut: number;
  closing: number;
  outstanding: number;
}) {
  const rows = [...bills].sort((a, b) => a.expense_date.localeCompare(b.expense_date));

  const totals = rows.reduce(
    (acc, b) => {
      acc.amount += amountAsOf(b, monthEnd);
      acc.paid += paidAgainst(b.payments, monthEnd);
      acc.due += outstandingOn(b, monthEnd);
      return acc;
    },
    { amount: 0, paid: 0, due: 0 }
  );

  const STATUS_LABEL: Record<string, string> = {
    paid: "Paid", partial: "Part paid", unpaid: "Unpaid",
  };

  return (
    <div className="hidden print:block print-sheet">
      {/* ── Masthead ── */}
      <div className="flex items-start justify-between border-b-2 border-black pb-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Level Up Fitness Club</h1>
          <p className="text-sm">Expenses — {format(parseISO(monthStart), "MMMM yyyy")}</p>
        </div>
        <div className="text-right text-xs leading-relaxed">
          <p>Printed {formatDate(new Date().toISOString().slice(0, 10))}</p>
          <p>Period {formatDate(monthStart)} – {formatDate(monthEnd)}</p>
          <p>{rows.length} bill{rows.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      {filterNote && (
        <p className="mb-3 text-xs border border-black px-2 py-1 inline-block">
          <strong>Filtered list — not the whole month.</strong> {filterNote}
        </p>
      )}

      {/* ── Bills ── */}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {["#", "Date", "Expense", "Category", "Paid to", "Amount", "Paid", "Outstanding", "Status", "✓"].map((h) => (
              <th
                key={h}
                className={`border border-black px-1.5 py-1 font-bold ${
                  ["Amount", "Paid", "Outstanding"].includes(h) ? "text-right" : "text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="border border-black px-2 py-6 text-center">
                No expenses recorded for this month.
              </td>
            </tr>
          ) : (
            rows.map((b, i) => {
              const amount = amountAsOf(b, monthEnd);
              const paid = paidAgainst(b.payments, monthEnd);
              const due = outstandingOn(b, monthEnd);
              const carried = b.expense_date < monthStart;
              return (
                <tr key={b.id}>
                  <td className="border border-black px-1.5 py-1 text-center">{i + 1}</td>
                  <td className="border border-black px-1.5 py-1 whitespace-nowrap">
                    {formatDate(b.expense_date)}
                    {/* An older unpaid bill still shows on this month's screen;
                        on paper that has to be obvious or it looks like a
                        date error. */}
                    {carried && <span className="block text-[9px]">brought forward</span>}
                  </td>
                  <td className="border border-black px-1.5 py-1">{b.title}</td>
                  <td className="border border-black px-1.5 py-1">{b.expense_head ?? "—"}</td>
                  <td className="border border-black px-1.5 py-1">{b.paid_to ?? "—"}</td>
                  <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">{formatPKR(amount)}</td>
                  <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">{paid > 0 ? formatPKR(paid) : "—"}</td>
                  <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">{due > 0.005 ? formatPKR(due) : "—"}</td>
                  <td className="border border-black px-1.5 py-1 whitespace-nowrap">
                    {STATUS_LABEL[expenseStatus(b, monthEnd)]}
                  </td>
                  {/* The tick box. */}
                  <td className="border border-black px-1.5 py-1 w-7" />
                </tr>
              );
            })
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={5} className="border border-black px-1.5 py-1.5 text-right font-bold">Totals</td>
              <td className="border border-black px-1.5 py-1.5 text-right font-bold whitespace-nowrap">{formatPKR(totals.amount)}</td>
              <td className="border border-black px-1.5 py-1.5 text-right font-bold whitespace-nowrap">{formatPKR(totals.paid)}</td>
              <td className="border border-black px-1.5 py-1.5 text-right font-bold whitespace-nowrap">{formatPKR(totals.due)}</td>
              <td className="border border-black px-1.5 py-1.5" colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>

      {/* ── Month summary ── */}
      <div className="mt-5 break-inside-avoid">
        <h2 className="text-sm font-bold border-b border-black pb-1 mb-2">Month summary</h2>
        {!configured ? (
          <p className="text-xs">
            Opening balance not configured, so no carry-forward figures can be shown.
          </p>
        ) : (
          <table className="text-xs border-collapse w-72">
            <tbody>
              {[
                ["Opening balance", opening],
                ["Income collected", income],
                ["Expenses paid", -paidOut],
                ["Closing balance", closing],
                ["Outstanding at month end", outstanding],
              ].map(([label, value], i, arr) => (
                <tr key={label as string} className={i === arr.length - 2 ? "font-bold" : ""}>
                  <td className="border border-black px-2 py-1">{label as string}</td>
                  <td className="border border-black px-2 py-1 text-right whitespace-nowrap">
                    {formatPKR(Math.abs(value as number))}
                    {(value as number) < 0 ? " out" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Sign-off ── */}
      <div className="mt-10 flex gap-16 break-inside-avoid">
        {["Checked by", "Approved by"].map((l) => (
          <div key={l} className="flex-1">
            <div className="border-b border-black h-8" />
            <p className="text-xs mt-1">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
