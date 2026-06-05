"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  labels: string[];
}

export function ProgressBar({ currentStep, totalSteps, labels }: ProgressBarProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const done = step < currentStep;
        const active = step === currentStep;

        return (
          <div key={step} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300",
                  done
                    ? "bg-[#F06418] border-[#F06418] text-white"
                    : active
                    ? "bg-white border-[#F06418] text-[#F06418]"
                    : "bg-white border-[#E4E4DE] text-[#7A7A72]"
                )}
              >
                {done ? <Check className="w-4 h-4" /> : step}
              </div>
              <span
                className={cn(
                  "text-xs font-medium hidden sm:block",
                  active ? "text-[#F06418]" : done ? "text-[#4A4A44]" : "text-[#7A7A72]"
                )}
              >
                {labels[i]}
              </span>
            </div>
            {/* Connector line */}
            {step < totalSteps && (
              <div
                className={cn(
                  "h-0.5 w-16 sm:w-24 -mt-5 mx-1 transition-all duration-300",
                  done ? "bg-[#F06418]" : "bg-[#E4E4DE]"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
