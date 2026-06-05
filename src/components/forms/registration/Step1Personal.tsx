"use client";

import { useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Camera, User } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { FullRegistrationData } from "@/lib/validations/registration";

interface Step1Props {
  form: UseFormReturn<FullRegistrationData>;
}

const REFERRAL_OPTIONS = [
  "Social Media (Instagram/Facebook)",
  "Friend / Family Referral",
  "Walk-in / Signage",
  "Google Search",
  "WhatsApp Group",
  "Other",
];

export function Step1Personal({ form }: Step1Props) {
  const { register, formState: { errors }, setValue, watch } = form;
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleDobChange(e: React.ChangeEvent<HTMLInputElement>) {
    const dob = new Date(e.target.value);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    setValue("age", age > 0 ? age : undefined);
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  const age = watch("age");

  return (
    <div className="space-y-6">
      {/* Photo upload */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative w-24 h-24 rounded-full border-2 border-dashed border-[#E4E4DE] hover:border-[#F06418] bg-[#FEF0E8] overflow-hidden transition-colors group"
        >
          {photoPreview ? (
            <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-1">
              <User className="w-8 h-8 text-[#F06418]" />
              <span className="text-[10px] text-[#7A7A72]">Photo</span>
            </div>
          )}
          <div className="absolute bottom-0 right-0 w-7 h-7 bg-[#F06418] rounded-full flex items-center justify-center">
            <Camera className="w-3.5 h-3.5 text-white" />
          </div>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
        />
      </div>

      {/* Personal info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input
            label="Full Name"
            required
            placeholder="e.g. Muhammad Arsal"
            error={errors.full_name?.message}
            {...register("full_name")}
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Father / Husband Name"
            placeholder="e.g. Muhammad Imran"
            {...register("secondary_name")}
          />
        </div>
        <div>
          <Input
            label="Date of Birth"
            type="date"
            {...register("dob", { onChange: handleDobChange })}
          />
        </div>
        <div>
          <Input
            label="Age"
            type="number"
            placeholder="Auto-calculated"
            value={age ?? ""}
            readOnly
            className="bg-gray-50 text-[#7A7A72]"
          />
        </div>
        <div>
          <Select
            label="Gender"
            required
            placeholder="Select gender"
            error={errors.gender?.message}
            {...register("gender")}
          >
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </Select>
        </div>
        <div>
          <Select
            label="Marital Status"
            placeholder="Select status"
            {...register("marital_status")}
          >
            <option value="Single">Single</option>
            <option value="Married">Married</option>
          </Select>
        </div>
      </div>

      {/* Contact */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Contact Information
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Phone Number"
            required
            type="tel"
            placeholder="0300-0000000"
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Input
            label="WhatsApp Number"
            type="tel"
            placeholder="Same as phone"
            {...register("whatsapp")}
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="optional@email.com"
            error={errors.email?.message}
            {...register("email")}
          />
          <Input
            label="CNIC"
            placeholder="XXXXX-XXXXXXX-X"
            error={errors.cnic?.message}
            {...register("cnic")}
          />
          <div className="sm:col-span-2">
            <Input
              label="Home Address"
              placeholder="Street, Area, City"
              {...register("address")}
            />
          </div>
        </div>
      </div>

      {/* Referral */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          How did you find us?
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Referral Source"
            placeholder="Select source"
            {...register("referral_source")}
          >
            {REFERRAL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
          <Input
            label="Referred by (Name)"
            placeholder="Name of person who referred you"
            {...register("referred_by")}
          />
        </div>
      </div>
    </div>
  );
}
