"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Numeric-only entry pad — cash tendered, split-payment amounts, discount
 * values. Distinct from OnScreenKeyboard (full QWERTY, for names/notes/
 * search) because a money amount never needs letters and a dedicated pad
 * is faster to hit accurately.
 *
 * Keys are 80px tall, matching the Phase 3 sizing spec (96x80 for keypad
 * keys) — larger than the 56px alnum keyboard because cash entry happens
 * under more time pressure at the counter.
 */
export function NumericKeypad({
  onDigit,
  onDoubleZero,
  onBackspace,
  onClear,
}: {
  onDigit: (d: string) => void;
  onDoubleZero: () => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <Key key={d} onClick={() => onDigit(d)}>
          {d}
        </Key>
      ))}
      <Key onClick={onDoubleZero}>00</Key>
      <Key onClick={() => onDigit("0")}>0</Key>
      <Key onClick={onBackspace} label="Backspace">
        <Delete className="w-6 h-6" />
      </Key>
      <button
        type="button"
        onClick={onClear}
        className="col-span-3 min-h-[48px] rounded-lg border border-[#E4E4DE] bg-white text-sm font-semibold text-[#7A7A72] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
      >
        Clear
      </button>
    </div>
  );
}

function Key({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "h-[80px] rounded-lg border border-[#E4E4DE] bg-white cursor-pointer",
        "flex items-center justify-center text-2xl font-bold text-[#1A1A16]",
        "transition-colors duration-100 active:scale-95 hover:bg-[#FEF0E8] hover:border-[#F06418]"
      )}
    >
      {children}
    </button>
  );
}
