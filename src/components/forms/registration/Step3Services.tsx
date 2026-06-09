"use client";

import { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import type { FullRegistrationData } from "@/lib/validations/registration";
import type { Package, StaffMember, SystemUser } from "@/types/database";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addMonths, format } from "date-fns";
import { Info } from "lucide-react";

interface Step3Props {
  form: UseFormReturn<FullRegistrationData>;
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

export function Step3Services({ form, mode, currentUser }: Step3Props) {
  const { register, watch, setValue } = form;
  const [packages, setPackages]     = useState<Package[]>([]);
  const [trainers, setTrainers]     = useState<StaffMember[]>([]);

  const joiningDate        = watch("joining_date");
  const selectedPackageIds = watch("package_ids") ?? [];

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("packages")
      .select("*")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("monthly_fee", { ascending: true })
      .then(({ data }) => setPackages(data ?? []));

    supabase
      .from("staff_members")
      .select("*")
      .eq("role", "Trainer")
      .eq("status", "active")
      .is("deleted_at", null)
      .then(({ data }) => setTrainers(data ?? []));

    if (mode === "staff" && currentUser) {
      setValue("handled_by", currentUser.id);
    }
  }, [mode, currentUser, setValue]);

  // Auto-calculate expiry from joining date
  useEffect(() => {
    if (joiningDate) {
      const expiry = format(addMonths(new Date(joiningDate), 1), "yyyy-MM-dd");
      setValue("expiry_date", expiry);
    }
  }, [joiningDate, setValue]);

  // Recalculate total monthly fee whenever selected packages change
  useEffect(() => {
    if (!packages.length) return;
    const total = selectedPackageIds.reduce((sum, id) => {
      const pkg = packages.find((p) => p.id === id);
      return sum + (pkg?.monthly_fee ?? 0);
    }, 0);
    setValue("monthly_fee", total > 0 ? total : 0);
    const primary = packages.find((p) => p.id === selectedPackageIds[0]);
    setValue("admission_fee", primary?.admission_fee ?? 15000);
  }, [selectedPackageIds, packages, setValue]);

  function togglePackage(pkgId: string) {
    const updated = selectedPackageIds.includes(pkgId)
      ? selectedPackageIds.filter((id) => id !== pkgId)
      : [...selectedPackageIds, pkgId];
    setValue("package_ids", updated);
    setValue("package_id", updated[0] ?? undefined);
  }

  const totalMonthly = selectedPackageIds.reduce((sum, id) => {
    const pkg = packages.find((p) => p.id === id);
    return sum + (pkg?.monthly_fee ?? 0);
  }, 0);

  // ── Public mode: just a notes field ──────────────────────────────────
  if (mode === "public") {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-1">
            Additional Information
          </h3>
          <p className="text-xs text-[#7A7A72] mb-3">
            Share any special requirements, fitness goals, or health conditions our staff should know about.
          </p>
          <textarea
            rows={4}
            placeholder="Any special requirements or fitness goals..."
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] placeholder-[#7A7A72] focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
            {...register("notes")}
          />
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 bg-[#FEF0E8] border border-[#FDDCC8] rounded-lg">
          <Info className="w-3.5 h-3.5 text-[#F06418] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#7A7A72]">
            Our staff will contact you to confirm your services, package, and fees after reviewing your application.
          </p>
        </div>
      </div>
    );
  }

  // ── Staff mode: services / packages multi-select + official details ──
  return (
    <div className="space-y-6">
      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-[#1A1A16] mb-1">Additional Notes</label>
        <textarea
          rows={2}
          placeholder="Any special requirements or fitness goals..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] placeholder-[#7A7A72] focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
          {...register("notes")}
        />
      </div>

      {/* Staff Section */}
      <div className="rounded-xl border border-[#E4E4DE] overflow-hidden">
        <div className="bg-[#1A1A1A] px-5 py-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#F06418]" />
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">
            Staff Section — Official Details
          </h3>
        </div>

        <div className="bg-white p-5 space-y-5">

          {/* Services / Packages multi-select */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-[#1A1A16]">
                Services &amp; Packages
              </label>
              <span className="text-xs text-[#7A7A72]">Select all that apply</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {packages.map((pkg) => {
                const selected = selectedPackageIds.includes(pkg.id);
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => togglePackage(pkg.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                      selected
                        ? "bg-[#FEF0E8] border-[#F06418]"
                        : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                    )}
                  >
                    <span className={cn("text-sm font-semibold leading-tight", selected ? "text-[#C04E10]" : "text-[#1A1A16]")}>
                      {pkg.name}
                    </span>
                    <span className={cn("text-xs font-medium", selected ? "text-[#F06418]" : "text-[#7A7A72]")}>
                      Rs {pkg.monthly_fee.toLocaleString()}/mo
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Fee breakdown */}
            {selectedPackageIds.length > 0 && (
              <div className="mt-3 bg-[#FEF0E8] border border-[#FDDCC8] rounded-lg p-3">
                <div className="space-y-1 mb-2">
                  {selectedPackageIds.map((id) => {
                    const pkg = packages.find((p) => p.id === id);
                    if (!pkg) return null;
                    return (
                      <div key={id} className="flex items-center justify-between text-xs text-[#4A4A44]">
                        <span>{pkg.name}</span>
                        <span className="font-semibold">Rs {pkg.monthly_fee.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[#FDDCC8]">
                  <span className="text-sm font-semibold text-[#1A1A16]">Total Monthly</span>
                  <span className="text-lg font-bold text-[#F06418]">
                    Rs {totalMonthly.toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Other fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Assign Trainer" placeholder="No trainer" {...register("trainer_id")}>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </Select>

            <Select label="Payment Method" placeholder="Select method" {...register("payment_method")}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>

            <Input label="Joining Date" type="date" {...register("joining_date")} />
            <Input label="Expiry Date"  type="date" {...register("expiry_date")} />

            <Input
              label="Admission Fee (Rs)"
              type="number"
              placeholder="15000"
              {...register("admission_fee", { valueAsNumber: true })}
            />
            <Input
              label="Monthly Fee (Rs)"
              type="number"
              placeholder="7500"
              {...register("monthly_fee", { valueAsNumber: true })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
