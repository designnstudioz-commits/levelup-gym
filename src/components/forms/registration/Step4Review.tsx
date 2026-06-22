"use client";

import { useEffect, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { FullRegistrationData } from "@/lib/validations/registration";
import type { Package } from "@/types/database";

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

export function Step4Review({ form, mode }: Step4Props) {
  const { register, watch, formState: { errors } } = form;
  const data = watch();
  const termsAgreed = watch("terms_agreed");
  const [packages, setPackages] = useState<Package[]>([]);

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

  const selectedPackageIds = data.package_ids ?? (data.package_id ? [data.package_id] : []);
  const packageNames = selectedPackageIds
    .map((id) => packages.find((pkg) => pkg.id === id)?.name)
    .filter(Boolean) as string[];

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
                <ReviewField
                  label="Admission Fee"
                  value={data.admission_fee ? `Rs ${Number(data.admission_fee).toLocaleString()}` : undefined}
                />
                <ReviewField
                  label="Monthly Fee"
                  value={data.monthly_fee ? `Rs ${Number(data.monthly_fee).toLocaleString()}` : undefined}
                />
                <ReviewField label="Payment Method" value={data.payment_method} />
              </>
            )}
          </div>
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
