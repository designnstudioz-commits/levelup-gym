"use client";

import { cn } from "@/lib/utils";
import { type ChangeEvent, type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

// Native date inputs don't reliably stop a stray extra digit in the year
// segment (e.g. typing "42026" instead of "2026") — some browsers happily
// commit it as a valid 5-digit-year date. min/max alone only flags the
// input as :invalid, it doesn't stop the bad value from reaching state, so
// this pairs them with an onChange guard that drops the change entirely
// when the year is out of range — same defense-in-depth spirit as the
// wheel-guard fix for number inputs.
const MIN_DATE = "1900-01-01";
const MAX_DATE = "2099-12-31";

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, required, className, id, type, onChange, min, max, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    const isDate = type === "date";

    function handleDateChange(e: ChangeEvent<HTMLInputElement>) {
      const val = e.target.value;
      if (val) {
        const year = val.split("-")[0];
        if (year.length > 4 || Number(year) < 1900 || Number(year) > 2099) return;
      }
      onChange?.(e);
    }

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-[#1A1A16]">
            {label}
            {required && <span className="text-[#F06418] ml-0.5">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          min={isDate ? (min ?? MIN_DATE) : min}
          max={isDate ? (max ?? MAX_DATE) : max}
          onChange={isDate ? handleDateChange : onChange}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-lg border bg-white",
            "text-[#1A1A16] placeholder-[#7A7A72]",
            "transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-[#F06418] focus:border-[#F06418]",
            error
              ? "border-red-400 focus:ring-red-400 focus:border-red-400"
              : "border-[#E4E4DE]",
            "disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-[#7A7A72]">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
