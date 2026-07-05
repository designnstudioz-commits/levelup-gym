"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { type SelectHTMLAttributes, forwardRef } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, required, placeholder, className, id, children, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-[#1A1A16]">
            {label}
            {required && <span className="text-[#F06418] ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "w-full px-3 py-2 pr-9 text-sm rounded-lg border bg-white",
              "text-[#1A1A16] appearance-none",
              "transition-colors duration-150",
              "focus:outline-none focus:ring-2 focus:ring-[#F06418] focus:border-[#F06418]",
              error
                ? "border-red-400 focus:ring-red-400"
                : "border-[#E4E4DE]",
              "disabled:bg-gray-50 disabled:cursor-not-allowed",
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {children}
          </select>
          <ChevronDown className="w-4 h-4 text-[#7A7A72] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-[#7A7A72]">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
