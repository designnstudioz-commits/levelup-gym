"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Package, Check } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { resolvePrice } from "@/lib/pos/pricing";
import type { TerminalProduct } from "@/lib/pos/catalog";
import type { PosOrderItemModifier, PosProductVariant } from "@/types/pos";

/**
 * "Customize item" — variants, modifier groups and the kitchen note.
 *
 * Follows the approved frame: product summary on the left, numbered groups
 * on the right, a live selection summary, then Cancel / Add to Cart.
 *
 * Required groups gate the Add button rather than being silently defaulted,
 * so a bowl never reaches the kitchen without its sauce chosen.
 */
export function ModifierSheet({
  product,
  memberAttached,
  onCancel,
  onOpenNoteKeyboard,
  note,
  onAdd,
}: {
  product: TerminalProduct;
  memberAttached: boolean;
  onCancel: () => void;
  onOpenNoteKeyboard: () => void;
  note: string | null;
  onAdd: (args: {
    variant: PosProductVariant | null;
    modifiers: PosOrderItemModifier[];
    qty: number;
    itemNote: string | null;
  }) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(
    product.variants.length > 0 ? product.variants[0].id : null
  );
  // group id -> selected modifier ids
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const g of product.modifierGroups) {
      const defaults = g.modifiers.filter((m) => m.is_default).map((m) => m.id);
      if (defaults.length > 0) initial[g.id] = g.selection_type === "single" ? [defaults[0]] : defaults;
    }
    return initial;
  });
  const [qty, setQty] = useState(1);

  const variant = product.variants.find((v) => v.id === variantId) ?? null;

  const chosen: PosOrderItemModifier[] = useMemo(() => {
    const out: PosOrderItemModifier[] = [];
    for (const g of product.modifierGroups) {
      for (const id of selected[g.id] ?? []) {
        const m = g.modifiers.find((x) => x.id === id);
        if (m) out.push({ group: g.name, name: m.name, price_delta: m.price_delta ?? 0 });
      }
    }
    return out;
  }, [product.modifierGroups, selected]);

  const modifiersTotal = chosen.reduce((s, m) => s + m.price_delta, 0);

  const price = resolvePrice({
    product,
    variant,
    modifiersTotal,
    memberAttached,
  });

  // Every required group must be satisfied before the item can be added.
  const unmet = product.modifierGroups.filter((g) => {
    if (!g.is_required) return false;
    const n = (selected[g.id] ?? []).length;
    return n < Math.max(g.min_select || 1, 1);
  });

  function toggle(groupId: string, modifierId: string, single: boolean, max: number | null) {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      if (single) return { ...prev, [groupId]: [modifierId] };
      if (current.includes(modifierId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== modifierId) };
      }
      // Silently ignoring a tap past the cap would read as a broken screen,
      // so the option is visibly disabled instead (see the button below).
      if (max != null && current.length >= max) return prev;
      return { ...prev, [groupId]: [...current, modifierId] };
    });
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-stretch">
      <div className="m-auto w-full max-w-6xl h-[92vh] mx-6 bg-[#F7F6F3] rounded-2xl border border-[#E4E4DE] flex overflow-hidden">
        {/* Left: what you're building */}
        <div className="w-[320px] flex-shrink-0 bg-white border-r border-[#E4E4DE] p-6 flex flex-col overflow-y-auto">
          <div className="h-[140px] rounded-xl bg-[#F7F6F3] border border-[#E4E4DE] flex items-center justify-center overflow-hidden flex-shrink-0">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Package className="w-8 h-8 text-[#CFCEC6]" />
            )}
          </div>

          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72]">
            {product.department_name}
          </p>
          <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] leading-tight">
            {product.name}
          </h2>
          {product.description && (
            <p className="mt-2 text-sm text-[#4A4A44] leading-snug">{product.description}</p>
          )}

          {product.variants.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-2">
                Size
              </p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!v.is_available}
                    onClick={() => setVariantId(v.id)}
                    className={cn(
                      "min-h-[48px] px-4 rounded-lg border text-sm font-semibold cursor-pointer transition-colors",
                      !v.is_available && "opacity-40 cursor-not-allowed",
                      variantId === v.id
                        ? "bg-[#F06418] text-white border-[#F06418]"
                        : "bg-white text-[#1A1A16] border-[#E4E4DE] hover:border-[#F06418]"
                    )}
                  >
                    {v.name}
                    {v.price_delta !== 0 && (
                      <span className="ml-1.5 opacity-80">
                        {v.price_delta > 0 ? "+" : ""}
                        {formatPKR(v.price_delta)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-6">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-2">
              Quantity
            </p>
            <div className="flex items-center gap-2">
              <StepBtn onClick={() => setQty((q) => Math.max(1, q - 1))} label="Decrease">
                <Minus className="w-5 h-5" />
              </StepBtn>
              <span className="flex-1 h-[56px] rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center justify-center text-xl font-bold tabular-nums">
                {qty}
              </span>
              <StepBtn onClick={() => setQty((q) => q + 1)} label="Increase">
                <Plus className="w-5 h-5" />
              </StepBtn>
            </div>
          </div>
        </div>

        {/* Right: the choices */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 pt-6 pb-3 flex-shrink-0">
            <h3 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
              Customize item
            </h3>
            <p className="text-sm text-[#7A7A72] mt-0.5">
              Choose required options and optional extras.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {product.modifierGroups.map((g, i) => {
              const sel = selected[g.id] ?? [];
              const single = g.selection_type === "single";
              const atCap = g.max_select != null && sel.length >= g.max_select;
              return (
                <div key={g.id} className="mb-6">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="text-base font-bold text-[#1A1A16]">
                      {i + 1}. {g.name}
                    </p>
                    <p className="text-xs text-[#7A7A72]">
                      {g.is_required
                        ? single ? "Choose 1" : `Choose at least ${Math.max(g.min_select || 1, 1)}`
                        : g.max_select
                          ? `Optional · select up to ${g.max_select}`
                          : "Optional"}
                    </p>
                  </div>

                  <div className="grid gap-2 grid-cols-2 lg:grid-cols-3">
                    {g.modifiers.map((m) => {
                      const on = sel.includes(m.id);
                      const blocked = !m.is_available || (!on && atCap && !single);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={blocked}
                          onClick={() => toggle(g.id, m.id, single, g.max_select)}
                          className={cn(
                            "min-h-[56px] px-4 rounded-lg border text-left cursor-pointer",
                            "flex items-center gap-2 transition-colors duration-150",
                            blocked && "opacity-40 cursor-not-allowed",
                            on
                              ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]"
                              : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:border-[#F06418]"
                          )}
                        >
                          <span
                            className={cn(
                              "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                              on ? "bg-[#F06418] border-[#F06418]" : "border-[#CFCEC6]"
                            )}
                          >
                            {on && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span className="text-sm font-semibold flex-1">{m.name}</span>
                          {m.price_delta !== 0 && (
                            <span className="text-xs font-semibold tabular-nums">
                              +{formatPKR(m.price_delta)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="mb-2">
              <p className="text-base font-bold text-[#1A1A16] mb-2">
                {product.modifierGroups.length + 1}. Special note
              </p>
              <button
                type="button"
                onClick={onOpenNoteKeyboard}
                className={cn(
                  "w-full min-h-[72px] px-4 py-3 rounded-lg border text-left cursor-pointer",
                  "transition-colors hover:border-[#F06418]",
                  note ? "bg-white border-[#F06418]" : "bg-white border-[#E4E4DE]"
                )}
              >
                <span className={cn("text-sm", note ? "text-[#1A1A16]" : "text-[#7A7A72]")}>
                  {note || "Tap to add a short kitchen note…"}
                </span>
              </button>
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-[#E4E4DE] bg-white px-6 py-4">
            <div className="flex items-end justify-between gap-4 mb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72]">
                  Selections
                </p>
                <p className="text-sm font-semibold text-[#1A1A16] truncate">
                  {chosen.length > 0
                    ? [variant?.name, ...chosen.map((m) => m.name)].filter(Boolean).join(" · ")
                    : variant?.name ?? "None"}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] tabular-nums">
                  {formatPKR(price.effectiveUnitPrice * qty)}
                </p>
                {price.memberPriceApplied && (
                  <p className="text-xs text-[#7A7A72] line-through tabular-nums">
                    {formatPKR(price.listUnitPrice * qty)}
                  </p>
                )}
              </div>
            </div>

            {unmet.length > 0 && (
              <p className="mb-2 text-xs font-semibold text-[#C04E10]">
                Still needed: {unmet.map((g) => g.name).join(", ")}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[64px] px-8 rounded-lg border border-[#E4E4DE] bg-white text-base font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={unmet.length > 0}
                onClick={() =>
                  onAdd({ variant, modifiers: chosen, qty, itemNote: note })
                }
                className={cn(
                  "flex-1 min-h-[64px] rounded-lg text-white text-base font-bold uppercase tracking-wide",
                  "transition-colors cursor-pointer active:scale-[0.99]",
                  unmet.length > 0
                    ? "bg-[#CFCEC6] cursor-not-allowed"
                    : "bg-[#F06418] hover:bg-[#C04E10]"
                )}
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-[56px] h-[56px] rounded-lg border border-[#E4E4DE] bg-white flex items-center justify-center text-[#1A1A16] hover:bg-[#FEF0E8] hover:border-[#F06418] transition-colors cursor-pointer active:scale-95"
    >
      {children}
    </button>
  );
}
