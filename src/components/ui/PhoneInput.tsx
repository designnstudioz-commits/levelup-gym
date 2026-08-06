"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PHONE_COUNTRIES, buildPhoneValue, formatLocalDigits, parsePhoneValue, type PhoneCountry } from "@/lib/phoneCountries";

interface PhoneInputProps {
  id?: string;
  label?: string;
  required?: boolean;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function PhoneInput({ id, label, required, error, value, onChange, placeholder }: PhoneInputProps) {
  const parsed = parsePhoneValue(value);
  // manualCountry only matters while the field is still empty — it lets
  // picking a country "stick" before any digits are typed (an empty value
  // can't be detected as anything but the default). The moment there's a
  // real value, the country is always re-derived from it, so an external
  // overwrite (e.g. the "Same as phone number" button) is reflected
  // correctly even if this field's dropdown was set to something else first.
  const [manualCountry, setManualCountry] = useState<PhoneCountry | null>(null);
  const country = value.trim() ? parsed.country : (manualCountry ?? parsed.country);
  const localDigits = parsed.localDigits;

  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  function handleCountryChange(code: string) {
    const next = PHONE_COUNTRIES.find((c) => c.code === code) ?? PHONE_COUNTRIES[0];
    setManualCountry(next);
    onChange(buildPhoneValue(next, localDigits));
  }

  function handleDigitsChange(raw: string) {
    onChange(buildPhoneValue(country, raw));
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-[#1A1A16]">
          {label}
          {required && <span className="text-[#F06418] ml-0.5">*</span>}
        </label>
      )}
      <div className="flex gap-1.5">
        <select
          aria-label="Country"
          value={country.code}
          onChange={(e) => handleCountryChange(e.target.value)}
          className="w-[92px] flex-shrink-0 px-2 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] focus:outline-none focus:ring-2 focus:ring-[#F06418] focus:border-[#F06418]"
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.dial ? `+${c.dial}` : c.code}
            </option>
          ))}
        </select>
        <input
          id={inputId}
          type="tel"
          placeholder={placeholder}
          value={formatLocalDigits(country, localDigits)}
          onChange={(e) => handleDigitsChange(e.target.value)}
          className={cn(
            "flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border bg-white",
            "text-[#1A1A16] placeholder-[#7A7A72]",
            "transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-[#F06418] focus:border-[#F06418]",
            error ? "border-red-400 focus:ring-red-400 focus:border-red-400" : "border-[#E4E4DE]"
          )}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
