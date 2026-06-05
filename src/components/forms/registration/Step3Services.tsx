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

interface Step3Props {
  form: UseFormReturn<FullRegistrationData>;
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

const SERVICES = [
  { id: "Gym", label: "Gym", icon: "🏋️" },
  { id: "Cardio", label: "Cardio", icon: "🚴" },
  { id: "Personal Training", label: "Personal Training", icon: "👤" },
  { id: "CrossFit", label: "CrossFit", icon: "⚡" },
  { id: "MMA", label: "MMA", icon: "🥊" },
  { id: "Table Tennis", label: "Table Tennis", icon: "🏓" },
  { id: "Zumba", label: "Zumba", icon: "💃" },
  { id: "Hybrid Workout", label: "Hybrid Workout", icon: "🔥" },
  { id: "METCON", label: "METCON", icon: "⏱️" },
  { id: "Nutritionist", label: "Nutritionist", icon: "🥗" },
  { id: "Paid Locker", label: "Paid Locker", icon: "🔒" },
  { id: "Shower Facility", label: "Shower", icon: "🚿" },
];

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

export function Step3Services({ form, mode, currentUser }: Step3Props) {
  const { register, watch, setValue, formState: { errors } } = form;
  const [packages, setPackages] = useState<Package[]>([]);
  const [trainers, setTrainers] = useState<StaffMember[]>([]);

  const selectedServices = watch("services_interested") ?? [];
  const joiningDate = watch("joining_date");
  const packageId = watch("package_id");

  useEffect(() => {
    if (mode !== "staff") return;
    const supabase = createClient();
    supabase
      .from("packages")
      .select("*")
      .eq("status", "active")
      .is("deleted_at", null)
      .then(({ data }) => setPackages(data ?? []));

    supabase
      .from("staff_members")
      .select("*")
      .eq("role", "Trainer")
      .eq("status", "active")
      .is("deleted_at", null)
      .then(({ data }) => setTrainers(data ?? []));

    if (currentUser) {
      setValue("handled_by", currentUser.id);
    }
  }, [mode, currentUser, setValue]);

  useEffect(() => {
    if (joiningDate) {
      const expiry = format(addMonths(new Date(joiningDate), 1), "yyyy-MM-dd");
      setValue("expiry_date", expiry);
    }
  }, [joiningDate, setValue]);

  useEffect(() => {
    if (packageId && packages.length > 0) {
      const pkg = packages.find((p) => p.id === packageId);
      if (pkg) {
        setValue("monthly_fee", pkg.monthly_fee);
        setValue("admission_fee", pkg.admission_fee);
      }
    }
  }, [packageId, packages, setValue]);

  function toggleService(serviceId: string) {
    const current = selectedServices;
    if (current.includes(serviceId)) {
      setValue("services_interested", current.filter((s) => s !== serviceId));
    } else {
      setValue("services_interested", [...current, serviceId]);
    }
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
                  "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all",
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
      </div>

      {/* Additional notes */}
      <div>
        <label className="block text-sm font-medium text-[#1A1A16] mb-1">
          Additional Notes
        </label>
        <textarea
          rows={3}
          placeholder="Any special requirements or goals..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] placeholder-[#7A7A72] focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
          {...register("notes")}
        />
      </div>

      {/* Staff-only section */}
      {mode === "staff" && (
        <div className="bg-[#1A1A1A] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">
            Staff Section — Official Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Select
                label="Package"
                placeholder="Select package"
                className="bg-[#2A2A2A] border-white/20 text-white"
                {...register("package_id")}
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} — Rs {pkg.monthly_fee.toLocaleString()}/mo
                    {(pkg as any).training_sessions > 0 ? ` · ${(pkg as any).training_sessions} PT sessions` : ""}
                  </option>
                ))}
              </Select>

              {/* Package preview card */}
              {packageId && (() => {
                const pkg = packages.find((p) => p.id === packageId);
                if (!pkg) return null;
                return (
                  <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-white">{pkg.name}</span>
                      <span className="text-sm font-bold text-[#F06418]">Rs {pkg.monthly_fee.toLocaleString()}/mo</span>
                    </div>
                    {(pkg as any).services_included?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {((pkg as any).services_included as string[]).map((s: string) => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 bg-white/10 text-white/70 rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <Select
              label="Assign Trainer"
              placeholder="No trainer"
              className="bg-[#2A2A2A] border-white/20 text-white"
              {...register("trainer_id")}
            >
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </Select>

            <Input
              label="Joining Date"
              type="date"
              className="bg-[#2A2A2A] border-white/20 text-white"
              {...register("joining_date")}
            />

            <Input
              label="Expiry Date"
              type="date"
              className="bg-[#2A2A2A] border-white/20 text-white"
              {...register("expiry_date")}
            />

            <Input
              label="Admission Fee (Rs)"
              type="number"
              placeholder="15000"
              className="bg-[#2A2A2A] border-white/20 text-white"
              {...register("admission_fee", { valueAsNumber: true })}
            />

            <Input
              label="Monthly Fee (Rs)"
              type="number"
              placeholder="7500"
              className="bg-[#2A2A2A] border-white/20 text-white"
              {...register("monthly_fee", { valueAsNumber: true })}
            />

            <Select
              label="Payment Method"
              placeholder="Select method"
              className="bg-[#2A2A2A] border-white/20 text-white"
              {...register("payment_method")}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
