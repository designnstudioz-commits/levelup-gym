"use client";

import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, required, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

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
