"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

interface SortableThProps {
  label: string;
  sortKey: string;
  currentKey: string;
  direction: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTh({ label, sortKey, currentKey, direction, onSort, className }: SortableThProps) {
  const active = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 cursor-pointer select-none hover:text-[#F06418] transition-colors whitespace-nowrap ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          direction === "asc" ? <ChevronUp className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 flex-shrink-0 opacity-30" />
        )}
      </span>
    </th>
  );
}

/** Generic 3-way toggle: clicking a new column starts ascending; clicking the
 *  active column flips direction. Shared by every sortable table so the click
 *  behavior stays consistent across pages. */
export function useSortToggle(
  sortKey: string,
  setSortKey: (key: string) => void,
  sortDir: "asc" | "desc",
  setSortDir: (dir: "asc" | "desc") => void
) {
  return function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
}

/** Generic comparator for string/number/null values, respecting direction. */
export function compareValues(a: unknown, b: unknown, direction: "asc" | "desc"): number {
  const mult = direction === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls sort last regardless of direction
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mult;
  return String(a).localeCompare(String(b)) * mult;
}
