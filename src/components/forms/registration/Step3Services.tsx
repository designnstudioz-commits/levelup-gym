"use client";

import { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import type { FullRegistrationData } from "@/lib/validations/registration";
import type { Package, SystemUser } from "@/types/database";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addMonths, format } from "date-fns";

interface Step3Props {
  form: UseFormReturn<FullRegistrationData>;
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

export function Step3Services({ form, mode, currentUser }: Step3Props) {
  const { register, watch, setValue } = form;
  const [packages, setPackages] = useState<Package[]>([]);

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
    setValue("monthly_fee", total);
    setValue("package_id", selectedPackageIds[0] ?? undefined);
  }, [selectedPackageIds, packages, setValue]);

  function togglePackage(pkgId: string) {
    const updated = selectedPackageIds.includes(pkgId)
      ? selectedPackageIds.filter((id) => id !== pkgId)
      : [...selectedPackageIds, pkgId];
    setValue("package_ids", updated);
  }

  const totalMonthly = selectedPackageIds.reduce((sum, id) => {
    const pkg = packages.find((p) => p.id === id);
    return sum + (pkg?.monthly_fee ?? 0);
  }, 0);

  // ── Public mode ───────────────────────────────────────────────────────
  if (mode === "public") {
    const selectedServices = watch("services_interested") ?? [];

    function toggleService(name: string) {
      const updated = selectedServices.includes(name)
        ? selectedServices.filter((s) => s !== name)
        : [...selectedServices, name];
      setValue("services_interested", updated);
    }

    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-[#1A1A16] mb-1">
            Which services are you interested in?
          </p>
          <p className="text-xs text-[#7A7A72] mb-4">
            Select all that apply — our staff will confirm details and pricing when they contact you.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {packages.map((pkg) => {
              const selected = selectedServices.includes(pkg.name);
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => toggleService(pkg.name)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                    selected
                      ? "bg-[#FEF0E8] border-[#F06418]"
                      : "bg-white border-[#E4E4DE] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                  )}
                >
                  <span className={cn("text-sm font-semibold leading-tight", selected ? "text-[#C04E10]" : "text-[#1A1A16]")}>
                    {pkg.name}
                  </span>
                  {pkg.monthly_fee > 0 && (
                    <span className={cn("text-xs font-medium", selected ? "text-[#F06418]" : "text-[#7A7A72]")}>
                      Rs {pkg.monthly_fee.toLocaleString()}/mo
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedServices.length > 0 && (
            <p className="text-xs text-[#F06418] mt-3 font-medium">
              {selectedServices.length} service{selectedServices.length !== 1 ? "s" : ""} selected
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Staff mode ────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Services multi-select */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-[#1A1A16]">Choose Interested Services</h3>
          {selectedPackageIds.length > 0 && (
            <span className="text-xs text-[#7A7A72]">{selectedPackageIds.length} selected</span>
          )}
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
                    : "bg-white border-[#E4E4DE] hover:border-[#F06418] hover:bg-[#FEF0E8]"
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

      {/* Enrollment details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E4E4DE]">
        <Select label="Payment Method" placeholder="Select method" {...register("payment_method")}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </Select>

        <div />

        <Input label="Joining Date" type="date" {...register("joining_date")} />
        <Input label="Expiry Date"  type="date" {...register("expiry_date")} />
      </div>
    </div>
  );
}
