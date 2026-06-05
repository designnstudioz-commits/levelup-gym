"use client";

import { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { FullRegistrationData } from "@/lib/validations/registration";

interface Step2Props {
  form: UseFormReturn<FullRegistrationData>;
}

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONS = ["Father", "Mother", "Spouse", "Brother", "Sister", "Son", "Daughter", "Friend", "Other"];

export function Step2Health({ form }: Step2Props) {
  const { register, formState: { errors }, watch } = form;
  const injuries = watch("injuries");

  return (
    <div className="space-y-6">
      {/* Physical stats */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Physical Information
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Height"
            placeholder="e.g. 5ft 10in or 178cm"
            {...register("height")}
          />
          <Input
            label="Weight"
            placeholder="e.g. 75 kg"
            {...register("weight")}
          />
          <Select
            label="Blood Group"
            placeholder="Select"
            {...register("blood_group")}
          >
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>{bg}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Medical info */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Medical Information
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Vaccination Status"
            placeholder="Select"
            {...register("vaccinated")}
          >
            <option value="Fully Vaccinated">Fully Vaccinated</option>
            <option value="Partially Vaccinated">Partially Vaccinated</option>
            <option value="Not Vaccinated">Not Vaccinated</option>
          </Select>

          <Select
            label="Any Injuries / Limitations?"
            placeholder="Select"
            {...register("injuries")}
          >
            <option value="None">None</option>
            <option value="Back pain">Back pain</option>
            <option value="Knee injury">Knee injury</option>
            <option value="Shoulder injury">Shoulder injury</option>
            <option value="Heart condition">Heart condition</option>
            <option value="Diabetes">Diabetes</option>
            <option value="Other">Other</option>
          </Select>

          {injuries && injuries !== "None" && (
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-[#1A1A16] mb-1">
                Please describe your condition
              </label>
              <textarea
                rows={3}
                placeholder="Describe your injury or limitation in detail..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] placeholder-[#7A7A72] focus:outline-none focus:ring-2 focus:ring-[#F06418] focus:border-[#F06418] resize-none"
                {...register("medical_notes")}
              />
            </div>
          )}
        </div>
      </div>

      {/* Emergency contact */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Emergency Contact
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Contact Name"
            required
            placeholder="Full name"
            error={errors.emergency_name?.message}
            {...register("emergency_name")}
          />
          <Select
            label="Relationship"
            placeholder="Select"
            {...register("emergency_relation")}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
          <Input
            label="Contact Phone"
            required
            type="tel"
            placeholder="0300-0000000"
            error={errors.emergency_phone?.message}
            {...register("emergency_phone")}
          />
        </div>
      </div>
    </div>
  );
}
