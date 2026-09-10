"use client";

import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * A single on/off toggle. Built for Phase 3D because the product form
 * needs several independent switches (Active, Show on POS, Available,
 * Track Stock) that must never collapse into one control — see the
 * product-states rule: Active / Show on POS / Available are three
 * separate axes, not one.
 */
export function Switch({ checked, onChange, label, hint, disabled }: SwitchProps) {
  return (
    <label className={cn("flex items-center gap-3", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative w-10 h-6 rounded-full transition-colors duration-150 flex-shrink-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-1",
          checked ? "bg-[#F06418]" : "bg-[#E4E4DE]",
          !disabled && "cursor-pointer"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-150",
            checked && "translate-x-4"
          )}
        />
      </button>
      {(label || hint) && (
        <span className="flex flex-col">
          {label && <span className="text-sm font-medium text-[#1A1A16]">{label}</span>}
          {hint && <span className="text-xs text-[#7A7A72]">{hint}</span>}
        </span>
      )}
    </label>
  );
}
