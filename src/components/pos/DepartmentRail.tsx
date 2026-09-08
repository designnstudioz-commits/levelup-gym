"use client";

import { Star, Clock, RotateCcw } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import type { PosDepartment } from "@/types/pos";

/**
 * Left rail: departments, quick access, and the cashier's own shift figure.
 *
 * Structure follows the approved frame. Styling is the existing Level Up
 * system — the active department is orange-on-tint (matching the dashboard
 * sidebar's active state) rather than the Figma's filled black.
 *
 * Rail targets are 64px tall, comfortably above the 44px WCAG 2.5.5 floor.
 */
export function DepartmentRail({
  departments,
  productCounts,
  activeDepartmentId,
  onSelectDepartment,
  heldCount,
  onOpenHeld,
  onOpenRecent,
  shiftTotal,
  shiftOrderCount,
  canSeeShiftTotals,
}: {
  departments: PosDepartment[];
  productCounts: Record<string, number>;
  /** null = "All Items" */
  activeDepartmentId: string | null;
  onSelectDepartment: (id: string | null) => void;
  heldCount: number;
  onOpenHeld: () => void;
  onOpenRecent: () => void;
  shiftTotal: number | null;
  shiftOrderCount: number | null;
  canSeeShiftTotals: boolean;
}) {
  const totalProducts = Object.values(productCounts).reduce((s, n) => s + n, 0);

  return (
    <aside className="w-[200px] flex-shrink-0 bg-white border-r border-[#E4E4DE] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3">
        <p className="px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72]">
          Departments
        </p>

        <div className="flex flex-col gap-1">
          <RailItem
            label="All Items"
            count={totalProducts}
            active={activeDepartmentId === null}
            onClick={() => onSelectDepartment(null)}
          />
          {departments.map((d) => (
            <RailItem
              key={d.id}
              label={d.name}
              count={productCounts[d.id] ?? 0}
              active={activeDepartmentId === d.id}
              onClick={() => onSelectDepartment(d.id)}
            />
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-[#E4E4DE]">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72]">
            Quick access
          </p>
          <div className="flex flex-col gap-1">
            <QuickItem icon={Star} label="Favourites" disabled />
            <QuickItem
              icon={Clock}
              label="Held Orders"
              badge={heldCount > 0 ? heldCount : undefined}
              onClick={onOpenHeld}
            />
            <QuickItem icon={RotateCcw} label="Recent Sales" onClick={onOpenRecent} />
          </div>
        </div>
      </div>

      {/* The cashier's OWN shift figure. They need it to count the drawer at
          close. Business-wide totals, other cashiers and any cost or margin
          stay out of the terminal entirely. */}
      {canSeeShiftTotals && shiftTotal !== null && (
        <div className="m-3 p-3 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex-shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7A7A72]">
            Current shift
          </p>
          <p className="text-xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] mt-0.5 tabular-nums">
            {formatPKR(shiftTotal)}
          </p>
          <p className="text-xs text-[#7A7A72]">
            {shiftOrderCount ?? 0} {shiftOrderCount === 1 ? "order" : "orders"}
          </p>
        </div>
      )}
    </aside>
  );
}

function RailItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full min-h-[64px] px-3 py-2 rounded-lg text-left cursor-pointer",
        "transition-colors duration-150 flex flex-col justify-center",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-1",
        "active:scale-[0.985]",
        active
          ? "bg-[#FEF0E8] border border-[#FDDCC8]"
          : "border border-transparent hover:bg-[#F7F6F3]"
      )}
    >
      <span
        className={cn(
          "text-[15px] font-semibold leading-tight",
          active ? "text-[#C04E10]" : "text-[#1A1A16]"
        )}
      >
        {label}
      </span>
      <span className={cn("text-xs tabular-nums", active ? "text-[#C04E10]/70" : "text-[#7A7A72]")}>
        {count}
      </span>
    </button>
  );
}

function QuickItem({
  icon: Icon,
  label,
  badge,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      className={cn(
        "w-full min-h-[56px] px-3 rounded-lg border text-left cursor-pointer",
        "flex items-center gap-2.5 transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-1",
        "active:scale-[0.985]",
        "border-[#E4E4DE] hover:bg-[#FEF0E8] hover:border-[#F06418]",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:border-[#E4E4DE]"
      )}
    >
      <Icon className="w-4 h-4 text-[#4A4A44] flex-shrink-0" />
      <span className="text-sm font-semibold text-[#1A1A16] flex-1">{label}</span>
      {badge !== undefined && (
        <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#F06418] text-white text-xs font-bold flex items-center justify-center tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
