"use client";
import { Printer } from "lucide-react";

export function PrintButton({ variant = "primary" }: { variant?: "primary" | "link" }) {
  if (variant === "link") {
    return (
      <button onClick={() => window.print()} className="text-sm text-[#7A7A72] hover:text-[#F06418] transition-colors underline">
        Print or Save as PDF
      </button>
    );
  }
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-2 px-4 py-2 bg-[#F06418] text-white rounded-lg text-sm font-semibold hover:bg-[#C04E10] transition-colors"
    >
      <Printer className="w-4 h-4" /> Print Receipt
    </button>
  );
}
