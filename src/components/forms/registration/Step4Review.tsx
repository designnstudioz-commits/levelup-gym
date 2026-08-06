"use client";

import { useEffect, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { cn, calculateDiscount, formatPKR, isPTPackage } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { FullRegistrationData } from "@/lib/validations/registration";
import type { Package, StaffMember } from "@/types/database";

interface Step4Props {
  form: UseFormReturn<FullRegistrationData>;
  mode: "public" | "staff";
}

const TERMS = [
  "I agree to follow all gym rules and regulations.",
  "I confirm that the information provided is accurate and complete.",
  "I acknowledge that Level Up Fitness Club is not liable for injuries due to negligence.",
  "I consent to my photo being used for membership identification purposes.",
  "I understand that fees once paid are non-refundable.",
  "I will maintain hygiene standards and proper gym etiquette at all times.",
  "I agree to inform the gym of any medical condition that may affect my training.",
  "I understand that membership may be revoked for violation of terms.",
];

function ReviewField({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;
  return (
    <div className="py-2 border-b border-[#E4E4DE] last:border-0">
      <p className="text-xs text-[#7A7A72] font-medium">{label}</p>
      <p className="text-sm text-[#1A1A16] font-medium mt-0.5">{value}</p>
    </div>
  );
}

function FeeBreakdownRow({
  label, badge, original, discountType, discountValue, lines, partial,
}: {
  label: string;
  badge?: React.ReactNode;
  original: number;
  discountType: "none" | "percent" | "amount" | undefined;
  discountValue: number | undefined;
  lines?: { method: string; amount: string }[];
  partial?: { isPartial: boolean; amountReceivedNow: string; balanceDueDate: string };
}) {
  if (!original) return null;
  const { discountAmount, finalAmount } = calculateDiscount(original, discountType, discountValue);
  const methodsText = (lines ?? [])
    .filter((l) => l.method && Number(l.amount) > 0)
    .map((l) => (lines!.length > 1 ? `${l.method} ${formatPKR(Number(l.amount))}` : l.method))
    .join(", ");
  return (
    <div className="py-2 border-b border-[#E4E4DE] last:border-0 sm:col-span-2">
      <p className="text-xs text-[#7A7A72] font-medium flex items-center gap-1.5">{label}{badge}</p>
      {discountAmount > 0 ? (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[#7A7A72] line-through">{formatPKR(original)}</span>
          <span className="text-xs text-[#F06418]">− {formatPKR(discountAmount)}</span>
          <span className="text-sm text-[#1A1A16] font-bold">= {formatPKR(finalAmount)}</span>
        </div>
      ) : (
        <p className="text-sm text-[#1A1A16] font-medium mt-0.5">{formatPKR(original)}</p>
      )}
      {methodsText && <p className="text-xs text-[#7A7A72] mt-0.5">via {methodsText}</p>}
      {partial?.isPartial && (
        <p className="text-xs text-amber-700 mt-0.5">
          Partial: collecting {formatPKR(Number(partial.amountReceivedNow) || 0)} now, balance {formatPKR(Math.max(finalAmount - (Number(partial.amountReceivedNow) || 0), 0))} due {partial.balanceDueDate || "—"}
        </p>
      )}
    </div>
  );
}

export function Step4Review({ form, mode }: Step4Props) {
  const { register, watch, formState: { errors } } = form;
  const data = watch();
  const termsAgreed = watch("terms_agreed");
  const [packages, setPackages] = useState<Package[]>([]);
  const [trainer, setTrainer] = useState<StaffMember | null>(null);

  useEffect(() => {
    const packageIds = data.package_ids ?? (data.package_id ? [data.package_id] : []);
    if (!packageIds?.length) {
      setPackages([]);
      return;
    }

    const supabase = createClient();
    const fetchPackages = async () => {
      const { data, error } = await supabase
        .from("packages")
        .select("*")
        .in("id", packageIds);

      if (error) {
        setPackages([]);
        return;
      }

      setPackages(data ?? []);
    };

    fetchPackages();
  }, [data.package_id, data.package_ids]);

  // Trainer name for the review's "Trainer & Commission" line — trainer_id
  // is only known as a raw id at this point, not fetched anywhere upstream.
  useEffect(() => {
    if (!data.trainer_id) {
      setTrainer(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from("staff_members")
      .select("*")
      .eq("id", data.trainer_id)
      .single()
      .then(({ data: staffData }) => setTrainer((staffData as StaffMember) ?? null));
  }, [data.trainer_id]);

  const selectedPackageIds = data.package_ids ?? (data.package_id ? [data.package_id] : []);
  const packageNames = selectedPackageIds
    .map((id) => packages.find((pkg) => pkg.id === id)?.name)
    .filter(Boolean) as string[];

  // Package Payment total = sum of each selected package's own independent
  // discount, mirroring Step3Services — not one discount over the summed
  // total.
  const packageSelections = data.package_selections ?? [];
  const hasPTSelected = selectedPackageIds.some((id) => {
    const pkg = packages.find((p) => p.id === id);
    return pkg && isPTPackage(pkg);
  });
  // Personal Training packages have no discount step — the custom price
  // typed in is the final amount directly, mirroring Step3Services.
  const packagesFinalTotal = selectedPackageIds.reduce((sum, id) => {
    const pkg = packages.find((p) => p.id === id);
    if (!pkg) return sum;
    const sel = packageSelections.find((s) => s.package_id === id);
    if (isPTPackage(pkg)) return sum + (sel?.custom_price ?? 0);
    return sum + calculateDiscount(pkg.monthly_fee ?? 0, sel?.discount_type, sel?.discount_value).finalAmount;
  }, 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Please review your information
        </h3>
        <div className="bg-[#F8F8F6] rounded-xl border border-[#E4E4DE] p-4 space-y-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <ReviewField label="Full Name" value={data.full_name} />
            <ReviewField label="Father / Husband Name" value={data.secondary_name} />
            <ReviewField label="Date of Birth" value={data.dob} />
            <ReviewField label="Age" value={data.age ? `${data.age} years` : undefined} />
            <ReviewField label="Gender" value={data.gender} />
            <ReviewField label="Marital Status" value={data.marital_status} />
            <ReviewField label="Phone" value={data.phone} />
            <ReviewField label="WhatsApp" value={data.whatsapp} />
            <ReviewField label="Email" value={data.email} />
            <ReviewField label="CNIC" value={data.cnic} />
            <ReviewField label="Blood Group" value={data.blood_group} />
            <ReviewField label="Vaccination" value={data.vaccinated} />
            <ReviewField label="Emergency Contact" value={data.emergency_name} />
            <ReviewField label="Emergency Phone" value={data.emergency_phone} />
            {packageNames.length > 0 && (
              <div className="py-2 border-b border-[#E4E4DE] sm:col-span-2">
                <p className="text-xs text-[#7A7A72] font-medium">Selected Package{packageNames.length > 1 ? "s" : ""}</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {packageNames.map((name) => (
                    <span key={name} className="bg-[#FEF0E8] text-[#C04E10] text-xs px-2 py-0.5 rounded-full font-medium">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {data.services_interested && data.services_interested.length > 0 && (
              <div className="py-2 border-b border-[#E4E4DE] sm:col-span-2">
                <p className="text-xs text-[#7A7A72] font-medium">Services Interested</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {data.services_interested.map((s) => (
                    <span key={s} className="bg-[#FEF0E8] text-[#C04E10] text-xs px-2 py-0.5 rounded-full font-medium">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {mode === "staff" && (
              <>
                <ReviewField label="Joining Date" value={data.joining_date} />
                <ReviewField label="Expiry Date" value={data.expiry_date} />
                <FeeBreakdownRow
                  label="Admission Fee"
                  original={Number(data.admission_fee) || 0}
                  discountType={data.admission_discount_type}
                  discountValue={data.admission_discount_value}
                  lines={data.admission_payment_lines}
                  partial={data.admission_partial}
                />
                {selectedPackageIds.map((id) => {
                  const pkg = packages.find((p) => p.id === id);
                  if (!pkg) return null;
                  const sel = packageSelections.find((s) => s.package_id === id);
                  return (
                    <FeeBreakdownRow
                      key={id}
                      label={pkg.name}
                      badge={isPTPackage(pkg) ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8]">PT</span>
                      ) : undefined}
                      original={isPTPackage(pkg) ? (sel?.custom_price ?? 0) : (pkg.monthly_fee ?? 0)}
                      discountType={sel?.discount_type}
                      discountValue={sel?.discount_value}
                    />
                  );
                })}
                {hasPTSelected && trainer && (
                  <div className="py-2 border-b border-[#E4E4DE] last:border-0 sm:col-span-2">
                    <p className="text-xs text-[#7A7A72] font-medium">Trainer & Commission</p>
                    <p className="text-sm text-[#1A1A16] font-medium mt-0.5">
                      {trainer.full_name}
                      {" — "}
                      {(data.commission_type ?? "percent") === "percent"
                        ? `${data.commission_percent ?? 0}% commission`
                        : `${formatPKR(data.commission_amount ?? 0)} commission per payment`}
                    </p>
                  </div>
                )}
                {packagesFinalTotal > 0 && (data.membership_payment_lines?.length || data.membership_partial?.isPartial) && (
                  <div className="py-2 border-b border-[#E4E4DE] last:border-0 sm:col-span-2">
                    <p className="text-xs text-[#7A7A72] font-medium">Package Payment</p>
                    {(() => {
                      const lines = data.membership_payment_lines ?? [];
                      const methodsText = lines
                        .filter((l) => l.method && Number(l.amount) > 0)
                        .map((l) => (lines.length > 1 ? `${l.method} ${formatPKR(Number(l.amount))}` : l.method))
                        .join(", ");
                      return methodsText ? <p className="text-xs text-[#7A7A72] mt-0.5">via {methodsText}</p> : null;
                    })()}
                    {data.membership_partial?.isPartial && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        Partial: collecting {formatPKR(Number(data.membership_partial.amountReceivedNow) || 0)} now, balance {formatPKR(Math.max(packagesFinalTotal - (Number(data.membership_partial.amountReceivedNow) || 0), 0))} due {data.membership_partial.balanceDueDate || "—"}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {mode === "staff" && (Number(data.admission_fee) > 0 || packagesFinalTotal > 0) && (
            <div className="flex items-center justify-between pt-3 mt-1 border-t border-[#E4E4DE]">
              <span className="text-sm font-semibold text-[#1A1A16]">Grand Total Collecting</span>
              <span className="text-lg font-bold text-[#F06418]">
                {formatPKR(
                  calculateDiscount(Number(data.admission_fee) || 0, data.admission_discount_type, data.admission_discount_value).finalAmount +
                  packagesFinalTotal
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Terms */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Membership Terms & Conditions
        </h3>
        <div className="bg-[#F8F8F6] rounded-xl border border-[#E4E4DE] p-4 max-h-40 overflow-y-auto space-y-2 mb-3">
          {TERMS.map((term, i) => (
            <div key={i} className="flex gap-2 text-sm text-[#4A4A44]">
              <span className="text-[#F06418] font-bold flex-shrink-0">{i + 1}.</span>
              <span>{term}</span>
            </div>
          ))}
        </div>

        <label className={cn(
          "flex items-start gap-3 cursor-pointer select-none p-3 rounded-lg border transition-colors",
          termsAgreed
            ? "bg-[#FEF0E8] border-[#F06418]"
            : "bg-white border-[#E4E4DE] hover:border-[#F06418]"
        )}>
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 accent-[#F06418] flex-shrink-0"
            {...register("terms_agreed")}
          />
          <span className="text-sm text-[#1A1A16] font-medium">
            I have read and agree to all the terms and conditions of Level Up Fitness Club membership.
          </span>
        </label>
        {errors.terms_agreed && (
          <p className="text-xs text-red-600 mt-1">{errors.terms_agreed.message as string}</p>
        )}
      </div>
    </div>
  );
}
