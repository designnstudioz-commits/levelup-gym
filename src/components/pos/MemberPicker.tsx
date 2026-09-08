"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, ChevronRight, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import type { CartMember } from "@/lib/pos/cart";

interface LookupMember {
  id: string;
  fullName: string;
  membershipNo: string | null;
  status: string | null;
}

/**
 * "Add a member to this order".
 *
 * Walk-in stays the default; a member is attached only when it matters.
 *
 * The status pill is CART-AWARE, per the approved frame: it reports whether
 * anything in the CURRENT basket is actually cheaper for a member, not
 * whether the member exists. "Member pricing available" on an order with no
 * discounted items would be a lie the cashier repeats to the customer.
 */
export function MemberPicker({
  cartHasMemberPricing,
  search,
  onOpenSearch,
  onClearSearch,
  onCancel,
  onContinueWalkIn,
  onSelect,
}: {
  cartHasMemberPricing: boolean;
  search: string;
  onOpenSearch: () => void;
  onClearSearch: () => void;
  onCancel: () => void;
  onContinueWalkIn: () => void;
  onSelect: (m: CartMember) => void;
}) {
  const [members, setMembers] = useState<LookupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pos/members/lookup?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const json = await res.json();
      setMembers(json.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(search); }, [load, search]);

  const selected = members.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[88vh] bg-white rounded-2xl border border-[#E4E4DE] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
              Add a member to this order
            </h2>
            <p className="text-sm text-[#7A7A72] mt-0.5">
              Walk-in remains the default. Select a member only when needed.
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

        <div className="px-6 pb-4 flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex-1 min-h-[56px] px-4 rounded-lg border border-[#E4E4DE] bg-white flex items-center gap-3 text-left hover:border-[#F06418] transition-colors cursor-pointer"
          >
            <Search className="w-5 h-5 text-[#7A7A72] flex-shrink-0" />
            <span className={cn("text-[15px] truncate", search ? "text-[#1A1A16] font-medium" : "text-[#7A7A72]")}>
              {search || "Search by name, phone or member ID"}
            </span>
          </button>
          {search && (
            <button
              type="button"
              onClick={onClearSearch}
              aria-label="Clear search"
              className="min-h-[56px] min-w-[56px] rounded-lg border border-[#E4E4DE] flex items-center justify-center text-[#4A4A44] hover:bg-[#FEF0E8] hover:border-[#F06418] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 min-h-[200px]">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72] pb-2">
            {search ? "Results" : "Recent members"}
          </p>

          {loading ? (
            <div className="py-12 flex items-center justify-center text-[#7A7A72]">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => void load(search)}
                className="mt-2 text-sm font-semibold text-[#F06418] hover:underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : members.length === 0 ? (
            <p className="py-12 text-center text-sm text-[#7A7A72]">
              No members found{search ? ` for “${search}”` : ""}.
            </p>
          ) : (
            <div className="flex flex-col gap-2 pb-2">
              {members.map((m) => {
                const expired = m.status !== "active";
                const on = selectedId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "w-full min-h-[76px] px-4 rounded-lg border flex items-center gap-3 text-left cursor-pointer",
                      "transition-colors duration-150 active:scale-[0.995]",
                      on
                        ? "bg-[#FEF0E8] border-[#F06418]"
                        : "bg-white border-[#E4E4DE] hover:border-[#F06418]"
                    )}
                  >
                    <span
                      className={cn(
                        "w-11 h-11 rounded-full flex items-center justify-center text-base font-bold flex-shrink-0",
                        expired ? "bg-[#CFCEC6] text-white" : "bg-[#1A1A1A] text-white"
                      )}
                    >
                      {m.fullName.charAt(0).toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-[#1A1A16] truncate">
                        {m.fullName}
                      </span>
                      <span className={cn("block text-xs", expired ? "text-red-600" : "text-[#7A7A72]")}>
                        {m.status ? m.status.charAt(0).toUpperCase() + m.status.slice(1) : "—"}
                        {m.membershipNo ? ` · ${m.membershipNo}` : ""}
                      </span>
                    </span>

                    {expired ? (
                      <Badge variant="rejected">Membership expired</Badge>
                    ) : cartHasMemberPricing ? (
                      <Badge variant="active">Member pricing available</Badge>
                    ) : (
                      <Badge variant="inactive">No special price on cart</Badge>
                    )}

                    <ChevronRight className="w-5 h-5 text-[#CFCEC6] flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#E4E4DE] flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onContinueWalkIn}
            className="min-h-[64px] px-6 rounded-lg border border-[#E4E4DE] bg-white text-base font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            Continue as Walk-in
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[64px] px-6 rounded-lg border border-[#E4E4DE] bg-white text-base font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() =>
              selected &&
              onSelect({
                id: selected.id,
                fullName: selected.fullName,
                membershipNo: selected.membershipNo,
                status: selected.status,
              })
            }
            className={cn(
              "min-h-[64px] px-8 rounded-lg text-white text-base font-bold uppercase tracking-wide transition-colors cursor-pointer",
              selected ? "bg-[#F06418] hover:bg-[#C04E10] active:scale-[0.99]" : "bg-[#CFCEC6] cursor-not-allowed"
            )}
          >
            Use Selected Member
          </button>
        </div>
      </div>
    </div>
  );
}
