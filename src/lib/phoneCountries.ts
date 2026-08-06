// Country-code + local-format support for phone/WhatsApp fields — scoped to
// the countries members actually register from today (per client request),
// not a full ~200-country list. Pakistan has no dial-code prefix and keeps
// the existing "0300-1234567" local convention (CLAUDE.md: phone numbers
// stored as-is, no normalization) — every other entry stores as
// "+<dial> <grouped digits>".

export interface PhoneCountry {
  code: string;
  name: string;
  flag: string;
  dial: string;       // "" for Pakistan (local format, no dial prefix)
  maxDigits: number;
  groups: number[];   // digit-group sizes for display formatting
  separator: string;
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "PK", name: "Pakistan",      flag: "🇵🇰", dial: "",    maxDigits: 11, groups: [4, 7],    separator: "-" },
  { code: "SA", name: "Saudi Arabia",  flag: "🇸🇦", dial: "966", maxDigits: 9,  groups: [3, 3, 3], separator: " " },
  { code: "GB", name: "UK",            flag: "🇬🇧", dial: "44",  maxDigits: 10, groups: [4, 6],    separator: " " },
  { code: "US", name: "USA",           flag: "🇺🇸", dial: "1",   maxDigits: 10, groups: [3, 3, 4], separator: " " },
  { code: "QA", name: "Qatar",         flag: "🇶🇦", dial: "974", maxDigits: 8,  groups: [4, 4],    separator: " " },
  { code: "AE", name: "UAE (Dubai)",   flag: "🇦🇪", dial: "971", maxDigits: 9,  groups: [2, 3, 4], separator: " " },
];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0]; // Pakistan

export function formatLocalDigits(country: PhoneCountry, rawDigits: string): string {
  const digits = rawDigits.replace(/\D/g, "").slice(0, country.maxDigits);
  return formatGrouped(digits, country.groups, country.separator);
}

function formatGrouped(digits: string, groups: number[], separator: string): string {
  const parts: string[] = [];
  let i = 0;
  for (const size of groups) {
    if (i >= digits.length) break;
    parts.push(digits.slice(i, i + size));
    i += size;
  }
  return parts.join(separator);
}

export function buildPhoneValue(country: PhoneCountry, rawDigits: string): string {
  const digits = rawDigits.replace(/\D/g, "").slice(0, country.maxDigits);
  const formatted = formatGrouped(digits, country.groups, country.separator);
  return country.dial ? (formatted ? `+${country.dial} ${formatted}` : "") : formatted;
}

// Given a stored value (e.g. "0300-1234567" or "+971 50 123 4567"), figures
// out which country it belongs to and pulls out just the local digits —
// longest dial code checked first so "+1..." doesn't false-match inside a
// "+971..."/"+966..." number.
export function parsePhoneValue(value: string): { country: PhoneCountry; localDigits: string } {
  const trimmed = (value ?? "").trim();
  if (trimmed.startsWith("+")) {
    const digitsOnly = trimmed.slice(1).replace(/\D/g, "");
    const byLongestDial = [...PHONE_COUNTRIES].filter((c) => c.dial).sort((a, b) => b.dial.length - a.dial.length);
    for (const country of byLongestDial) {
      if (digitsOnly.startsWith(country.dial)) {
        return { country, localDigits: digitsOnly.slice(country.dial.length) };
      }
    }
  }
  return { country: DEFAULT_PHONE_COUNTRY, localDigits: trimmed.replace(/\D/g, "") };
}
