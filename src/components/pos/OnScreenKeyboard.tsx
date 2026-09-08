"use client";

import { useEffect, useState } from "react";
import { Delete, ArrowBigUp, CornerDownLeft, Space, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-screen on-screen QWERTY.
 *
 * The terminal is a touch monitor with no physical keyboard, but the
 * approved UX uses search fields for products and members and a free-text
 * kitchen note. Rather than redesign those screens away from the approved
 * structure, the keyboard comes to them.
 *
 * Keys are 56px tall — above the 44px WCAG 2.5.5 floor and sized for
 * one-finger use at speed.
 */
const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export function OnScreenKeyboard({
  title,
  placeholder,
  initialValue = "",
  submitLabel = "Done",
  onSubmit,
  onCancel,
  /** Optional one-tap presets shown above the keys — used for kitchen notes,
   *  where a handful of phrases cover most of what staff ever type. */
  presets,
}: {
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  presets?: string[];
}) {
  const [value, setValue] = useState(initialValue);
  const [shift, setShift] = useState(false);

  // A physical keyboard may still be attached during development, and a
  // scanner (which types) will be later. Accepting real key events costs
  // nothing and makes both work.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key === "Enter")  { onSubmit(value.trim()); return; }
      if (e.key === "Backspace") { setValue((v) => v.slice(0, -1)); return; }
      if (e.key.length === 1) setValue((v) => v + e.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [value, onCancel, onSubmit]);

  function press(k: string) {
    setValue((v) => v + (shift ? k.toUpperCase() : k));
    if (shift) setShift(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center">
      <div className="w-full bg-white border-t border-[#E4E4DE] rounded-t-2xl flex flex-col max-h-[92vh]">
        <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
          <h2 className="text-xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#4A4A44] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-4 flex-shrink-0">
          <div className="min-h-[64px] px-4 py-3 rounded-lg border-2 border-[#F06418] bg-white flex items-center">
            <span
              className={cn(
                "text-lg",
                value ? "text-[#1A1A16] font-medium" : "text-[#7A7A72]"
              )}
            >
              {value || placeholder || ""}
            </span>
            <span className="ml-0.5 w-0.5 h-6 bg-[#F06418] animate-pulse" aria-hidden />
          </div>

          {presets && presets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue((v) => (v ? `${v}, ${p}` : p))}
                  className="min-h-[44px] px-4 rounded-lg border border-[#E4E4DE] bg-white text-sm font-semibold text-[#1A1A16] hover:bg-[#FEF0E8] hover:border-[#F06418] transition-colors cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pb-4 overflow-y-auto">
          <div className="flex flex-col gap-2">
            {ROWS.map((row, i) => (
              <div key={i} className="flex gap-2 justify-center">
                {i === 3 && (
                  <Key wide onClick={() => setShift((s) => !s)} active={shift} label="Shift">
                    <ArrowBigUp className="w-5 h-5" />
                  </Key>
                )}
                {row.map((k) => (
                  <Key key={k} onClick={() => press(k)}>
                    {shift ? k.toUpperCase() : k}
                  </Key>
                ))}
                {i === 3 && (
                  <Key wide onClick={() => setValue((v) => v.slice(0, -1))} label="Backspace">
                    <Delete className="w-5 h-5" />
                  </Key>
                )}
              </div>
            ))}

            <div className="flex gap-2 justify-center">
              <Key onClick={() => press("-")}>-</Key>
              <Key onClick={() => press(".")}>.</Key>
              <button
                type="button"
                onClick={() => press(" ")}
                aria-label="Space"
                className="h-[56px] flex-1 max-w-[420px] rounded-lg border border-[#E4E4DE] bg-white flex items-center justify-center text-[#4A4A44] hover:bg-[#FEF0E8] hover:border-[#F06418] transition-colors cursor-pointer active:scale-95"
              >
                <Space className="w-5 h-5" />
              </button>
              <Key onClick={() => setValue("")} wide label="Clear">
                Clear
              </Key>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#E4E4DE] flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[64px] px-8 rounded-lg border border-[#E4E4DE] bg-white text-base font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value.trim())}
            className="flex-1 min-h-[64px] rounded-lg bg-[#F06418] hover:bg-[#C04E10] text-white text-base font-bold uppercase tracking-wide transition-colors cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <CornerDownLeft className="w-5 h-5" />
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  wide,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  wide?: boolean;
  active?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "h-[56px] rounded-lg border flex items-center justify-center cursor-pointer",
        "text-lg font-semibold transition-colors duration-100 active:scale-95",
        wide ? "px-5 min-w-[76px]" : "w-[56px]",
        active
          ? "bg-[#F06418] border-[#F06418] text-white"
          : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:bg-[#FEF0E8] hover:border-[#F06418]"
      )}
    >
      {children}
    </button>
  );
}
