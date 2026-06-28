"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Send } from "lucide-react";

import { ProgressBar } from "./ProgressBar";
import { Step1Personal } from "./Step1Personal";
import { Step2Health } from "./Step2Health";
import { Step3Services } from "./Step3Services";
import { Step4Review } from "./Step4Review";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { generateMembershipNo } from "@/lib/utils";
import {
  fullRegistrationSchema,
  step1Schema,
  step2Schema,
  step3Schema,
  type FullRegistrationData,
} from "@/lib/validations/registration";
import type { SystemUser } from "@/types/database";

interface RegistrationFormProps {
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

const STEP_LABELS = ["Personal", "Health", "Services", "Review"];
const stepSchemas = [step1Schema, step2Schema, step3Schema];

export function RegistrationForm({ mode, currentUser }: RegistrationFormProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [newMemberId, setNewMemberId] = useState<string | null>(null);

  const form = useForm<FullRegistrationData>({
    resolver: zodResolver(fullRegistrationSchema),
    defaultValues: {
      services_interested: [],
      gender: undefined,
    },
    mode: "onTouched",
  });

  async function handleNext() {
    const schema = stepSchemas[currentStep - 1];
    if (schema) {
      const values = form.getValues();
      const result = schema.safeParse(values);
      if (!result.success) {
        result.error.issues.forEach((issue: any) => {
          if (issue.path && issue.path[0]) {
            const field = issue.path[0] as keyof FullRegistrationData;
            form.setError(field, { message: issue.message });
          }
        });
        return;
      }
    }
    setCurrentStep((s) => Math.min(s + 1, 4));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    const values = form.getValues();
    if (!values.terms_agreed) {
      form.setError("terms_agreed", { message: "You must agree to the terms" });
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();

      if (mode === "staff") {
        // Staff registration → directly create member (skip approval queue)
        const membershipNo = await generateMembershipNo(values.gender);

        const { data, error } = await supabase
          .from("members")
          .insert({
            membership_no: membershipNo,
            full_name: values.full_name,
            secondary_name: values.secondary_name || null,
            dob: values.dob || null,
            age: values.age || null,
            gender: values.gender,
            marital_status: values.marital_status || null,
            phone: values.phone,
            whatsapp: values.whatsapp || null,
            email: values.email || null,
            cnic: values.cnic || null,
            address: values.address || null,
            blood_group: values.blood_group || null,
            vaccinated: values.vaccinated || null,
            height: values.height || null,
            weight: values.weight || null,
            medical_notes: values.medical_notes
              ? `Injuries: ${values.injuries || "None"}. ${values.medical_notes}`
              : values.injuries && values.injuries !== "None"
              ? `Injuries: ${values.injuries}`
              : null,
            emergency_name: values.emergency_name,
            emergency_phone: values.emergency_phone,
            photo_url: values.photo_url || null,
            package_id: values.package_id || (values.package_ids?.[0] ?? null),
            package_ids: values.package_ids?.length ? values.package_ids : null,
            trainer_id: values.trainer_id || null,
            joining_date: values.joining_date || null,
            expiry_date: values.expiry_date || null,
            admission_fee: values.admission_fee || null,
            monthly_fee: values.monthly_fee || null,
            status: "active",
          })
          .select("id")
          .single();

        if (error) throw error;

        // Log the activity
        await supabase.from("activity_logs").insert({
          action: "added_member",
          entity_type: "member",
          entity_id: data.id,
          description: `Added new member ${values.full_name} — ${membershipNo}`,
          metadata: { membership_no: membershipNo, package_id: values.package_id },
        });

        setNewMemberId(data.id);
        setReferenceNo(membershipNo);
        setSubmitted(true);
        toast.success(`Member ${values.full_name} added! ID: ${membershipNo}`);
      } else {
        // Public registration → create submission for approval
        const { data, error } = await supabase
          .from("submissions")
          .insert({
            full_name: values.full_name,
            secondary_name: values.secondary_name || null,
            dob: values.dob || null,
            age: values.age || null,
            gender: values.gender,
            marital_status: values.marital_status || null,
            phone: values.phone,
            whatsapp: values.whatsapp || null,
            email: values.email || null,
            cnic: values.cnic || null,
            address: values.address || null,
            referral_source: values.referral_source || null,
            referred_by: values.referred_by || null,
            height: values.height || null,
            weight: values.weight || null,
            blood_group: values.blood_group || null,
            vaccinated: values.vaccinated || null,
            injuries: values.injuries || null,
            medical_notes: values.medical_notes || null,
            emergency_name: values.emergency_name,
            emergency_relation: values.emergency_relation || null,
            emergency_phone: values.emergency_phone,
            services_interested: values.services_interested?.length
              ? values.services_interested
              : null,
            notes: values.notes || null,
            photo_url: values.photo_url || null,
            status: "pending",
          })
          .select("id")
          .single();

        if (error) throw error;

        const prefix = values.gender === "Female" ? "LUF" : "LUM";
        const ref = `${prefix}-${new Date().getFullYear()}-${data.id.slice(-4).toUpperCase()}`;
        setReferenceNo(ref);
        setSubmitted(true);
        toast.success("Registration submitted successfully!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    form.reset();
    setCurrentStep(1);
    setSubmitted(false);
    setReferenceNo("");
    setNewMemberId(null);
  }

  // Success screen
  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
          <CheckCircle2 className="w-9 h-9 text-green-600" />
        </div>
        <h2
          className="text-2xl font-bold text-[#1A1A16] mb-2 uppercase"
          style={{ fontFamily: "var(--font-barlow-condensed)" }}
        >
          {mode === "staff" ? "Member Added!" : "Registration Submitted!"}
        </h2>

        {mode === "staff" ? (
          <>
            <p className="text-[#4A4A44] mb-1">Member has been created successfully.</p>
            <p className="text-[#4A4A44] mb-6">
              Membership No:{" "}
              <span className="font-bold text-[#F06418]">{referenceNo}</span>
            </p>
            <div className="flex gap-3">
              <Button onClick={handleReset} variant="secondary">
                Add Another
              </Button>
              <Button onClick={() => router.push(`/dashboard/members/${newMemberId}`)}>
                View Member Profile
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[#4A4A44] mb-1">Your application has been received.</p>
            <p className="text-[#4A4A44] mb-6">
              Reference:{" "}
              <span className="font-bold text-[#F06418]">{referenceNo}</span>
            </p>
            <p className="text-sm text-[#7A7A72] max-w-sm mb-8">
              Our team will review your application and contact you within 24 hours to confirm your membership.
            </p>
            <Button onClick={handleReset} variant="secondary">
              Register Another Member
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <ProgressBar currentStep={currentStep} totalSteps={4} labels={STEP_LABELS} />

      <div className="min-h-[400px]">
        {currentStep === 1 && <Step1Personal form={form} />}
        {currentStep === 2 && <Step2Health form={form} />}
        {currentStep === 3 && (
          <Step3Services form={form} mode={mode} currentUser={currentUser} />
        )}
        {currentStep === 4 && <Step4Review form={form} mode={mode} />}
      </div>

      <div className="flex items-center justify-between mt-8 pt-5 border-t border-[#E4E4DE]">
        <Button
          type="button"
          variant="secondary"
          onClick={handleBack}
          disabled={currentStep === 1}
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>

        {currentStep < 4 ? (
          <Button type="button" onClick={handleNext}>
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button type="button" onClick={handleSubmit} loading={submitting}>
            <Send className="w-4 h-4" />
            {mode === "staff" ? "Create Member" : "Submit Registration"}
          </Button>
        )}
      </div>
    </div>
  );
}
