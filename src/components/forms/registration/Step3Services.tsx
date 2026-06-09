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
import { ChevronDown, ChevronUp, Info, Sparkles } from "lucide-react";

interface Step3Props {
  form: UseFormReturn<FullRegistrationData>;
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

const SERVICES = [
  { id: "Gym",              label: "Gym",              icon: "🏋️" },
  { id: "Cardio",           label: "Cardio",           icon: "🚴" },
  { id: "Personal Training",label: "Personal Training",icon: "👤" },
  { id: "CrossFit",         label: "CrossFit",         icon: "⚡" },
  { id: "MMA",              label: "MMA",              icon: "🥊" },
  { id: "Zumba",            label: "Zumba",            icon: "💃" },
  { id: "Table Tennis",     label: "Table Tennis",     icon: "🏓" },
  { id: "Hybrid Workout",   label: "Hybrid Workout",   icon: "🔥" },
  { id: "METCON",           label: "METCON",           icon: "⏱️" },
  { id: "Nutritionist",     label: "Nutritionist",     icon: "🥗" },
  { id: "Physiotherapy",    label: "Physiotherapy",    icon: "🩺" },
  { id: "Paid Locker",      label: "Paid Locker",      icon: "🔒" },
  { id: "Shower Facility",  label: "Shower",           icon: "🚿" },
];

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

// For each selected service, auto-select the package whose name matches exactly
function autoPackagesFromServices(services: string[], pkgs: Package[]): string[] {
  const serviceSet = new Set(services.map((s) => s.toLowerCase()));
  return pkgs
    .filter((p) => serviceSet.has(p.name.toLowerCase()))
    .map((p) => p.id);
}

export function Step3Services({ form, mode, currentUser }: Step3Props) {
  const { register, watch, setValue, formState: { errors } } = form;
  const [packages, setPackages] = useState<Package[]>([]);
  const [trainers, setTrainers] = useState<StaffMember[]>([]);
  const [nutritionists, setNutritionists] = useState<StaffMember[]>([]);
  const [showPricing, setShowPricing] = useState(false);

  const selectedServices = watch("services_interested") ?? [];
  const joiningDate      = watch("joining_date");
  const packageId        = watch("package_id");
  const selectedPackageIds = watch("package_ids") ?? [];

  const wantsTraining    = selectedServices.includes("Personal Training");
  const wantsNutritionist = selectedServices.includes("Nutritionist");
  const wantsPhysio      = selectedServices.includes("Physiotherapy");

  useEffect(() => {
    const supabase = createClient();

    // Always load packages (used for pricing guide in public mode + staff selection)
    supabase
      .from("packages")
      .select("*")
      .eq("status", "active")
      .is("deleted_at", null)
      .then(({ data }) => setPackages(data ?? []));

    // Load trainers (for preference in public mode + assignment in staff mode)
    supabase
      .from("staff_members")
      .select("*")
      .eq("role", "Trainer")
      .eq("status", "active")
      .is("deleted_at", null)
      .then(({ data }) => setTrainers(data ?? []));

    supabase
      .from("staff_members")
      .select("*")
      .eq("role", "Nutritionist")
      .eq("status", "active")
      .is("deleted_at", null)
      .then(({ data }) => setNutritionists(data ?? []));

    if (mode === "staff" && currentUser) {
      setValue("handled_by", currentUser.id);
    }
  }, [mode, currentUser, setValue]);

  useEffect(() => {
    if (joiningDate) {
      const expiry = format(addMonths(new Date(joiningDate), 1), "yyyy-MM-dd");
      setValue("expiry_date", expiry);
    }
  }, [joiningDate, setValue]);

  // Auto-select packages matching selected services (by name), staff mode only
  useEffect(() => {
    if (!packages.length || mode !== "staff") return;
    const matched = autoPackagesFromServices(selectedServices, packages);
    setValue("package_ids", matched);
    setValue("package_id", matched[0] ?? undefined);
  }, [selectedServices, packages, setValue, mode]);

  // Recalculate total monthly fee whenever selected packages change
  useEffect(() => {
    if (!packages.length) return;
    const total = selectedPackageIds.reduce((sum, id) => {
      const pkg = packages.find((p) => p.id === id);
      return sum + (pkg?.monthly_fee ?? 0);
    }, 0);
    if (total > 0) setValue("monthly_fee", total);
    // Use admission_fee from first selected package (or 0 if add-on only)
    const primary = packages.find((p) => p.id === selectedPackageIds[0]);
    if (primary) setValue("admission_fee", primary.admission_fee);
  }, [selectedPackageIds, packages, setValue]);

  function toggleService(serviceId: string) {
    const current = selectedServices;
    if (current.includes(serviceId)) {
      setValue("services_interested", current.filter((s) => s !== serviceId));
    } else {
      setValue("services_interested", [...current, serviceId]);
    }
  }

  function togglePackage(pkgId: string) {
    const current = selectedPackageIds;
    const updated = current.includes(pkgId)
      ? current.filter((id) => id !== pkgId)
      : [...current, pkgId];
    setValue("package_ids", updated);
    setValue("package_id", updated[0] ?? undefined);
  }

  return (
    <div className="space-y-6">
      {/* Services checkboxes */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Services Interested In
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SERVICES.map((service) => {
            const selected = selectedServices.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => toggleService(service.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left",
                  selected
                    ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]"
                    : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                )}
              >
                <span>{service.icon}</span>
                <span>{service.label}</span>
              </button>
            );
          })}
        </div>

        {/* Admission fee note */}
        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-[#FEF0E8] border border-[#FDDCC8] rounded-lg">
          <Info className="w-3.5 h-3.5 text-[#F06418] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#7A7A72]">
            A one-time <span className="font-semibold text-[#1A1A16]">Admission / Registration Fee of Rs 15,000</span> applies to all new memberships, in addition to the monthly package fee.
          </p>
        </div>

        {/* Pricing guide — public mode */}
        {mode === "public" && packages.length > 0 && (
          <div className="mt-3 border border-[#E4E4DE] rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPricing((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-[#F8F8F6] text-sm font-medium text-[#4A4A44] hover:bg-[#FEF0E8] transition-colors"
            >
              <span>View package pricing</span>
              {showPricing ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showPricing && (
              <div className="divide-y divide-[#E4E4DE]">
                {packages.map((pkg) => (
                  <div key={pkg.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-[#1A1A16]">{pkg.name}</span>
                    <span className="text-sm font-semibold text-[#F06418]">
                      Rs {pkg.monthly_fee.toLocaleString()}<span className="text-[#7A7A72] font-normal text-xs">/mo</span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#F8F8F6]">
                  <span className="text-xs text-[#7A7A72]">+ One-time admission fee</span>
                  <span className="text-sm font-semibold text-[#1A1A16]">Rs 15,000</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trainer preference — public mode, shown when Personal Training selected */}
      {mode === "public" && wantsTraining && trainers.length > 0 && (
        <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-[#1A1A16]">Personal Training — Trainer Preference</h4>
          <p className="text-xs text-[#7A7A72]">Select a preferred trainer. Final assignment is confirmed by staff, and training charges will be discussed at enrollment.</p>
          <Select
            label="Preferred Trainer"
            placeholder="No preference"
            {...register("trainer_preference")}
          >
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </Select>
        </div>
      )}

      {/* Nutritionist preference — public mode */}
      {mode === "public" && wantsNutritionist && nutritionists.length > 0 && (
        <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-[#1A1A16]">Nutritionist — Preference</h4>
          <p className="text-xs text-[#7A7A72]">Select a preferred nutritionist. Final assignment and fees are confirmed at enrollment.</p>
          <Select
            label="Preferred Nutritionist"
            placeholder="No preference"
            {...register("nutritionist_preference")}
          >
            {nutritionists.map((n) => (
              <option key={n.id} value={n.id}>{n.full_name}</option>
            ))}
          </Select>
        </div>
      )}

      {/* Physiotherapy note */}
      {mode === "public" && wantsPhysio && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
          <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Our physiotherapy service is offered by appointment. Our team will contact you to schedule your first session after your membership is approved.
          </p>
        </div>
      )}

      {/* Additional notes */}
      <div>
        <label className="block text-sm font-medium text-[#1A1A16] mb-1">
          Additional Notes
        </label>
        <textarea
          rows={3}
          placeholder="Any special requirements or fitness goals..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] placeholder-[#7A7A72] focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
          {...register("notes")}
        />
      </div>

      {/* Staff-only section */}
      {mode === "staff" && (
        <div className="rounded-xl border border-[#E4E4DE] overflow-hidden">
          {/* Header */}
          <div className="bg-[#1A1A1A] px-5 py-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#F06418]" />
            <h3 className="text-sm font-semibold text-white uppercase tracking-wide">
              Staff Section — Official Details
            </h3>
          </div>

          {/* Body */}
          <div className="bg-white p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Multi-select packages */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-[#1A1A16] mb-2">
                  Packages <span className="text-xs text-[#7A7A72] font-normal ml-1">Select all that apply</span>
                </label>
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
                            ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]"
                            : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                        )}
                      >
                        <span className="text-sm font-semibold leading-tight">{pkg.name}</span>
                        <span className={cn("text-xs font-medium", selected ? "text-[#F06418]" : "text-[#7A7A72]")}>
                          Rs {pkg.monthly_fee.toLocaleString()}/mo
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Auto-selected hint */}
                {selectedPackageIds.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-2">
                    <Sparkles className="w-3 h-3 flex-shrink-0" />
                    Auto-selected based on services — adjust as needed
                  </p>
                )}

                {/* Total fee summary */}
                {selectedPackageIds.length > 0 && (
                  <div className="mt-3 bg-[#FEF0E8] border border-[#FDDCC8] rounded-lg p-3">
                    <div className="space-y-1 mb-2">
                      {selectedPackageIds.map((id) => {
                        const pkg = packages.find((p) => p.id === id);
                        if (!pkg) return null;
                        return (
                          <div key={id} className="flex items-center justify-between text-xs text-[#4A4A44]">
                            <span>{pkg.name}</span>
                            <span className="font-medium">Rs {pkg.monthly_fee.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-[#FDDCC8]">
                      <span className="text-sm font-semibold text-[#1A1A16]">Total Monthly</span>
                      <span className="text-base font-bold text-[#F06418]">
                        Rs {selectedPackageIds.reduce((sum, id) => {
                          const pkg = packages.find((p) => p.id === id);
                          return sum + (pkg?.monthly_fee ?? 0);
                        }, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

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
              <Input label="Expiry Date" type="date" {...register("expiry_date")} />

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
      )}
    </div>
  );
}
