"use client";

import { LayoutGrid, List, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list" | "compact";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  options?: ViewMode[];
}

const VIEW_OPTIONS: { mode: ViewMode; icon: React.ElementType; label: string }[] = [
  { mode: "grid",    icon: LayoutGrid, label: "Grid" },
  { mode: "compact", icon: LayoutList, label: "Compact" },
  { mode: "list",    icon: List,       label: "List" },
];

export function ViewToggle({ value, onChange, options = ["grid", "compact", "list"] }: ViewToggleProps) {
  const visible = VIEW_OPTIONS.filter((o) => options.includes(o.mode));

  return (
    <div className="flex bg-white border border-[#E4E4DE] rounded-lg p-1 gap-0.5">
      {visible.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          title={label}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            value === mode
              ? "bg-[#F06418] text-white"
              : "text-[#7A7A72] hover:bg-[#F8F8F6] hover:text-[#1A1A16]"
          )}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
