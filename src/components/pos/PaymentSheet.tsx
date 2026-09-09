"use client";

import { useMemo, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { NumericKeypad } from "./NumericKeypad";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import type { CartLine, CartTotals } from "@/lib/pos/cart";
import type { PosPaymentMethod } from "@/types/pos";

const METHODS: PosPaymentMethod[] = ["Cash", "Card", "Bank Transfer", "EasyPaisa", "JazzCash"];

export interface DraftPayment {
  method: PosPaymentMethod;
  amount: number;
  tendered?: number;
  changeGiven?: number;
  reference?: string;
}

/**
 * "Choose payment method" — full-screen overlay per the approved frame,
 * not a small modal. Owns its own amount-entry state; the parent only
 * receives a finished, validated set of payments on submit.
 *
 * Handles both a single method (the common case — two taps: method, then
 * Complete Payment) and Split Payment, where several methods cover one
 * order and the last committed row exactly zeroes the remaining balance.
 */
export function PaymentSheet({
  lines,
  totals,
  customerLabel,
  quickCashDenominations,
  busy,
  onCancel,
  onComplete,
}: {
  lines: CartLine[];
  totals: CartTotals;
  customerLabel: string;
  quickCashDenominations: number[];
  busy: boolean;
  onCancel: () => void;
  onComplete: (payments: DraftPayment[]) => void;
}) {
  const [splitMode, setSplitMode] = useState(false);

  // ── Single-method state ────────────────────────────────────────────
  const [method, setMethod] = useState<PosPaymentMethod | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [reference, setReference] = useState("");
  const [referenceKeyboard, setReferenceKeyboard] = useState(false);

  // ── Split state ─────────────────────────────────────────────────────
  const [committed, setCommitted] = useState<DraftPayment[]>([]);
  const [rowMethod, setRowMethod] = useState<PosPaymentMethod | null>(null);
  const [rowAmountStr, setRowAmountStr] = useState("");

  const amount = Number(amountStr) || 0;
  const remaining = Math.max(totals.total - committed.reduce((s, p) => s + p.amount, 0), 0);
  const rowAmount = Number(rowAmountStr) || 0;

  const usedMethods = new Set(committed.map((p) => p.method));
  const availableForNextRow = METHODS.filter((m) => !usedMethods.has(m));

  function appendDigit(setStr: (fn: (v: string) => string) => void, d: string) {
    setStr((v) => (v === "0" ? d : v + d));
  }

  // ── Single-method flow ───────────────────────────────────────────────
  function quickCashSingle(kind: "exact" | number) {
    if (kind === "exact") { setAmountStr(String(totals.total)); return; }
    setAmountStr((v) => String((Number(v) || 0) + kind));
  }

  const singleTendered = method === "Cash" ? amount : totals.total;
  const singleChange = method === "Cash" ? Math.max(amount - totals.total, 0) : 0;
  const singleValid =
    method !== null && (method !== "Cash" || amount >= totals.total);

  function completeSingle() {
    if (!method || !singleValid) return;
    const payment: DraftPayment = {
      method,
      amount: totals.total,
      ...(method === "Cash" ? { tendered: singleTendered, changeGiven: singleChange } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    };
    onComplete([payment]);
  }

  // ── Split flow ────────────────────────────────────────────────────
  const rowTendered = rowMethod === "Cash" ? rowAmount : Math.min(rowAmount || remaining, remaining);
  const rowValid =
    rowMethod !== null &&
    (rowMethod === "Cash" ? rowAmount >= Math.min(rowAmount || remaining, remaining) : true);

  function quickCashRow(kind: "exact" | number) {
    if (kind === "exact") { setRowAmountStr(String(remaining)); return; }
    setRowAmountStr((v) => String((Number(v) || 0) + kind));
  }

  function commitRow() {
    if (!rowMethod) return;
    // For a non-cash row default to whatever is still owed; for cash use
    // exactly what the cashier typed as tendered against this row's share.
    const rowShare = rowMethod === "Cash" ? Math.min(rowAmount, remaining) : Math.min(rowAmount || remaining, remaining);
    if (rowShare <= 0) return;
    const payment: DraftPayment = {
      method: rowMethod,
      amount: rowShare,
      ...(rowMethod === "Cash" ? { tendered: rowTendered, changeGiven: Math.max(rowTendered - rowShare, 0) } : {}),
    };
    setCommitted((c) => [...c, payment]);
    setRowMethod(null);
    setRowAmountStr("");
  }

  function removeRow(idx: number) {
    setCommitted((c) => c.filter((_, i) => i !== idx));
  }

  function completeSplit() {
    if (remaining > 0 || committed.length === 0) return;
    onComplete(committed);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-stretch">
      <div className="m-auto w-full max-w-6xl h-[92vh] mx-6 bg-white rounded-2xl border border-[#E4E4DE] flex overflow-hidden">
        {/* Left: order summary, always visible */}
        <div className="w-[300px] flex-shrink-0 bg-[#F7F6F3] border-r border-[#E4E4DE] p-6 flex flex-col overflow-y-auto">
          <h2 className="text-xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
            Order Summary
          </h2>
          <p className="text-xs text-[#7A7A72] mt-1">{customerLabel}</p>

          <div className="mt-4 flex-1 overflow-y-auto divide-y divide-[#E4E4DE]">
            {lines.map((l) => (
              <div key={l.key} className="py-2 flex items-start justify-between gap-2 text-sm">
                <span className="text-[#1A1A16]">
                  {l.productName}
                  {l.qty > 1 && <span className="text-[#7A7A72]"> ×{l.qty}</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-4 mt-4 border-t border-[#E4E4DE] space-y-1.5">
            <SummaryRow label="Subtotal" value={formatPKR(totals.subtotal)} />
            {totals.discountAmount > 0 && (
              <SummaryRow label="Discount" value={`− ${formatPKR(totals.discountAmount)}`} />
            )}
          </div>
          <div className="pt-3 mt-2 border-t border-[#E4E4DE] flex items-baseline justify-between">
            <span className="text-sm font-semibold text-[#1A1A16]">Total due</span>
            <span className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] tabular-nums">
              {formatPKR(totals.total)}
            </span>
          </div>
        </div>

        {/* Right: method selection / entry */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-4 flex-shrink-0">
            <div>
              <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
                {splitMode ? "Split order payment" : "Choose payment method"}
              </h2>
              <p className="text-sm text-[#7A7A72] mt-0.5">
                {splitMode ? "Use multiple payment methods for one order." : "Confirmed methods for Level Up POS"}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#4A4A44] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!splitMode ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {METHODS.map((m) => (
                    <MethodTile
                      key={m}
                      label={m}
                      sub={methodSub(m)}
                      active={method === m}
                      onClick={() => { setMethod(m); setAmountStr(""); }}
                    />
                  ))}
                  <MethodTile
                    label="Split Payment"
                    sub="Use two or more methods"
                    active={false}
                    onClick={() => setSplitMode(true)}
                    className="col-span-2"
                  />
                </div>

                {method && (
                  <div className="mt-6 grid grid-cols-2 gap-6">
                    <div>
                      {method === "Cash" ? (
                        <>
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-1">
                            Cash received
                          </p>
                          <div className="min-h-[64px] px-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center text-2xl font-bold text-[#1A1A16] tabular-nums">
                            {formatPKR(amount)}
                          </div>
                          <p className="mt-3 text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-1">
                            Change
                          </p>
                          <div
                            className={cn(
                              "min-h-[64px] px-4 rounded-lg flex items-center text-2xl font-bold tabular-nums",
                              singleChange > 0 ? "bg-green-50 text-green-700" : "bg-[#F7F6F3] text-[#1A1A16]"
                            )}
                          >
                            {formatPKR(singleChange)}
                          </div>
                          <div className="mt-3 grid grid-cols-4 gap-2">
                            <QuickCashBtn label="Exact" onClick={() => quickCashSingle("exact")} />
                            {quickCashDenominations.map((d) => (
                              <QuickCashBtn key={d} label={formatPKR(d)} onClick={() => quickCashSingle(d)} />
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-1">
                            Amount to charge
                          </p>
                          <div className="min-h-[64px] px-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center text-2xl font-bold text-[#1A1A16] tabular-nums">
                            {formatPKR(totals.total)}
                          </div>
                          <button
                            type="button"
                            onClick={() => setReferenceKeyboard(true)}
                            className="mt-3 w-full min-h-[52px] px-4 rounded-lg border border-[#E4E4DE] bg-white text-left text-sm hover:border-[#F06418] transition-colors cursor-pointer"
                          >
                            <span className={reference ? "text-[#1A1A16] font-medium" : "text-[#7A7A72]"}>
                              {reference || "Add reference (optional)"}
                            </span>
                          </button>
                        </>
                      )}
                    </div>

                    {method === "Cash" && (
                      <NumericKeypad
                        onDigit={(d) => appendDigit(setAmountStr, d)}
                        onDoubleZero={() => appendDigit(setAmountStr, "00")}
                        onBackspace={() => setAmountStr((v) => v.slice(0, -1))}
                        onClear={() => setAmountStr("")}
                      />
                    )}
                  </div>
                )}
              </>
            ) : (
              <SplitView
                total={totals.total}
                remaining={remaining}
                committed={committed}
                onRemoveRow={removeRow}
                rowMethod={rowMethod}
                rowAmountStr={rowAmountStr}
                availableMethods={availableForNextRow}
                onSelectRowMethod={(m) => { setRowMethod(m); setRowAmountStr(String(remaining)); }}
                onDigit={(d) => appendDigit(setRowAmountStr, d)}
                onDoubleZero={() => appendDigit(setRowAmountStr, "00")}
                onBackspace={() => setRowAmountStr((v) => v.slice(0, -1))}
                onClear={() => setRowAmountStr("")}
                onQuickCash={quickCashRow}
                quickCashDenominations={quickCashDenominations}
                onCommitRow={commitRow}
                rowValid={rowValid}
              />
            )}
          </div>

          <div className="flex-shrink-0 border-t border-[#E4E4DE] px-6 py-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => (splitMode ? setSplitMode(false) : onCancel())}
              className="min-h-[64px] px-8 rounded-lg border border-[#E4E4DE] bg-white text-base font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy || (splitMode ? remaining > 0 || committed.length === 0 : !singleValid)}
              onClick={splitMode ? completeSplit : completeSingle}
              className={cn(
                "flex-1 min-h-[64px] rounded-lg text-white text-base font-bold uppercase tracking-wide",
                "transition-colors cursor-pointer active:scale-[0.99] flex items-center justify-center gap-2",
                busy || (splitMode ? remaining > 0 || committed.length === 0 : !singleValid)
                  ? "bg-[#CFCEC6] cursor-not-allowed"
                  : "bg-[#F06418] hover:bg-[#C04E10]"
              )}
            >
              {busy && <Loader2 className="w-5 h-5 animate-spin" />}
              {splitMode ? "Complete Split Payment" : "Complete Payment"}
            </button>
          </div>
        </div>
      </div>

      {referenceKeyboard && (
        <OnScreenKeyboard
          title="Payment reference"
          placeholder="Transaction ID or card last 4"
          initialValue={reference}
          submitLabel="Save"
          onSubmit={(v) => { setReference(v); setReferenceKeyboard(false); }}
          onCancel={() => setReferenceKeyboard(false)}
        />
      )}
    </div>
  );
}

function methodSub(m: PosPaymentMethod): string {
  switch (m) {
    case "Cash": return "Fast cash checkout";
    case "Card": return "Card terminal payment";
    case "Bank Transfer": return "Record transfer reference";
    case "EasyPaisa": return "Digital wallet";
    case "JazzCash": return "Digital wallet";
  }
}

function MethodTile({
  label,
  sub,
  active,
  onClick,
  className,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[80px] px-5 py-3 rounded-xl border-2 text-left cursor-pointer",
        "transition-colors duration-150 active:scale-[0.99]",
        active
          ? "bg-[#FEF0E8] border-[#F06418]"
          : "bg-white border-[#E4E4DE] hover:border-[#F06418]",
        className
      )}
    >
      <span className="block text-base font-bold text-[#1A1A16]">{label}</span>
      <span className="block text-xs text-[#7A7A72] mt-0.5">{sub}</span>
    </button>
  );
}

function QuickCashBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[48px] rounded-lg border border-[#E4E4DE] bg-white text-sm font-semibold text-[#1A1A16] hover:bg-[#FEF0E8] hover:border-[#F06418] transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#4A4A44]">{label}</span>
      <span className="font-medium text-[#1A1A16] tabular-nums">{value}</span>
    </div>
  );
}

function SplitView({
  total,
  remaining,
  committed,
  onRemoveRow,
  rowMethod,
  rowAmountStr,
  availableMethods,
  onSelectRowMethod,
  onDigit,
  onDoubleZero,
  onBackspace,
  onClear,
  onQuickCash,
  quickCashDenominations,
  onCommitRow,
  rowValid,
}: {
  total: number;
  remaining: number;
  committed: DraftPayment[];
  onRemoveRow: (idx: number) => void;
  rowMethod: PosPaymentMethod | null;
  rowAmountStr: string;
  availableMethods: PosPaymentMethod[];
  onSelectRowMethod: (m: PosPaymentMethod) => void;
  onDigit: (d: string) => void;
  onDoubleZero: () => void;
  onBackspace: () => void;
  onClear: () => void;
  onQuickCash: (kind: "exact" | number) => void;
  quickCashDenominations: number[];
  onCommitRow: () => void;
  rowValid: boolean;
}) {
  const rowAmount = Number(rowAmountStr) || 0;

  return (
    <div>
      <div className="rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] p-4 flex items-center justify-between mb-5">
        <div>
          <p className="text-xs text-[#7A7A72]">Total due</p>
          <p className="text-2xl font-bold text-[#1A1A16] tabular-nums">{formatPKR(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#7A7A72]">Remaining</p>
          <p className={cn("text-2xl font-bold tabular-nums", remaining > 0 ? "text-red-600" : "text-green-700")}>
            {formatPKR(remaining)}
          </p>
        </div>
      </div>

      {committed.map((p, i) => (
        <div key={i} className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7A7A72] mb-1">
            Payment {i + 1}
          </p>
          <div className="flex items-center justify-between rounded-lg border border-[#E4E4DE] bg-white px-4 py-3">
            <div>
              <p className="text-base font-bold text-[#1A1A16]">{p.method}</p>
              <p className="text-sm text-[#7A7A72] tabular-nums">{formatPKR(p.amount)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded-full bg-green-50 text-green-700 text-xs font-bold">PAID</span>
              <button
                type="button"
                onClick={() => onRemoveRow(i)}
                className="min-h-[44px] px-3 rounded-lg border border-[#E4E4DE] text-sm font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      ))}

      {remaining > 0 && availableMethods.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7A7A72] mb-1">
            Payment {committed.length + 1}
          </p>
          <div className="rounded-lg border border-[#E4E4DE] bg-white p-4">
            <p className="text-xs font-semibold text-[#7A7A72] mb-2">Choose method</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {availableMethods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSelectRowMethod(m)}
                  className={cn(
                    "min-h-[48px] px-4 rounded-lg border text-sm font-semibold cursor-pointer transition-colors",
                    rowMethod === m
                      ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                      : "bg-white text-[#1A1A16] border-[#E4E4DE] hover:border-[#F06418]"
                  )}
                >
                  {rowMethod === m && "✓ "}
                  {m}
                </button>
              ))}
            </div>

            {rowMethod && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold text-[#7A7A72] mb-1">Amount</p>
                  <div className="min-h-[56px] px-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center text-xl font-bold text-[#1A1A16] tabular-nums">
                    {formatPKR(rowAmount)}
                  </div>
                  {rowMethod === "Cash" && (
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      <QuickCashBtn label="Exact" onClick={() => onQuickCash("exact")} />
                      {quickCashDenominations.map((d) => (
                        <QuickCashBtn key={d} label={formatPKR(d)} onClick={() => onQuickCash(d)} />
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!rowValid}
                    onClick={onCommitRow}
                    className={cn(
                      "mt-3 w-full min-h-[52px] rounded-lg text-sm font-bold uppercase tracking-wide cursor-pointer transition-colors",
                      rowValid ? "bg-[#F06418] hover:bg-[#C04E10] text-white" : "bg-[#CFCEC6] text-white cursor-not-allowed"
                    )}
                  >
                    Add payment
                  </button>
                </div>
                <NumericKeypad
                  onDigit={onDigit}
                  onDoubleZero={onDoubleZero}
                  onBackspace={onBackspace}
                  onClear={onClear}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
