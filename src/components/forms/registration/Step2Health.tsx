"use client";

import { useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { FullRegistrationData } from "@/lib/validations/registration";
import { formatPhone } from "@/lib/utils";

interface Step2Props {
  form: UseFormReturn<FullRegistrationData>;
}

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONS = ["Father", "Mother", "Spouse", "Brother", "Sister", "Son", "Daughter", "Friend", "Other"];

export function Step2Health({ form }: Step2Props) {
  const { register, formState: { errors }, watch, setValue } = form;
  const injuries = watch("injuries");
  const documents = watch("documents") ?? [];
  const [uploading, setUploading] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);

  async function handleDocumentAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload/document", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || json.error) {
          toast.error(`${file.name}: ${json.error ?? "Upload failed"}`);
        } else {
          setValue("documents", [...(watch("documents") ?? []), json.url]);
          toast.success(`${file.name} uploaded`);
        }
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (docRef.current) docRef.current.value = "";
    }
  }

  function removeDocument(url: string) {
    setValue("documents", documents.filter((d) => d !== url));
  }

  function getFileName(url: string) {
    return decodeURIComponent(url.split("/").pop() ?? url).replace(/^\d+-[a-z0-9]+\./, "");
  }

  return (
    <div className="space-y-6">
      {/* Physical stats */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-3">
          Physical Information
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Height" placeholder="e.g. 5ft 10in or 178cm" {...register("height")} />
          <Input label="Weight" placeholder="e.g. 75 kg" {...register("weight")} />
          <Select label="Blood Group" placeholder="Select" {...register("blood_group")}>
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
          <div>
            <Select
              label="Vaccination Status"
              placeholder="Select"
              {...register("vaccinated")}
            >
              <option value="Fully Vaccinated">Fully Vaccinated (COVID-19 + Hepatitis)</option>
              <option value="Partially Vaccinated">Partially Vaccinated</option>
              <option value="Not Vaccinated">Not Vaccinated</option>
              <option value="Unknown">Unknown / Prefer not to say</option>
            </Select>
            <p className="text-[11px] text-[#7A7A72] mt-1">
              Covers COVID-19, Hepatitis B, and other communicable disease vaccinations
            </p>
          </div>

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
          <Select label="Relationship" placeholder="Select" {...register("emergency_relation")}>
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
            value={watch("emergency_phone") ?? ""}
            onChange={(e) => setValue("emergency_phone", formatPhone(e.target.value), { shouldValidate: true })}
          />
        </div>
      </div>

      {/* Document upload */}
      <div>
        <h3 className="text-sm font-semibold text-[#4A4A44] uppercase tracking-wide mb-1">
          Supporting Documents <span className="text-[#7A7A72] font-normal normal-case">(Optional)</span>
        </h3>
        <p className="text-[11px] text-[#7A7A72] mb-3">
          Upload ID card, medical certificates, vaccination records, or other relevant documents. PDF or image files up to 5 MB each.
        </p>

        {/* Uploaded files */}
        {documents.length > 0 && (
          <div className="space-y-2 mb-3">
            {documents.map((url) => (
              <div key={url} className="flex items-center gap-2 px-3 py-2 bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg">
                <Paperclip className="w-3.5 h-3.5 text-[#F06418] flex-shrink-0" />
                <span className="text-xs text-[#4A4A44] flex-1 truncate">{getFileName(url)}</span>
                <button
                  type="button"
                  onClick={() => removeDocument(url)}
                  className="text-[#7A7A72] hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => !uploading && docRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-[#E4E4DE] rounded-lg text-sm text-[#4A4A44] hover:border-[#F06418] hover:bg-[#FEF0E8] hover:text-[#C04E10] transition-colors disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {uploading ? "Uploading…" : "Upload Document"}
        </button>
        <input
          ref={docRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleDocumentAdd}
        />
      </div>
    </div>
  );
}
