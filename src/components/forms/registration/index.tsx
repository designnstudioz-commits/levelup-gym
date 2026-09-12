"use client";

import { useRef, useState } from "react";
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
import { Modal } from "@/components/ui/Modal";
import { createClient } from "@/lib/supabase/client";
import { calculateDiscount, formatPKR, buildCommissionPayload } from "@/lib/utils";
import { format } from "date-fns";
import {
  fullRegistrationSchema,
  step1Schema,
  step1StaffSchema,
  step2Schema,
  step3Schema,
  step3StaffSchema,
  type FullRegistrationData,
} from "@/lib/validations/registration";
import type { SystemUser, PackageBreakdownItem } from "@/types/database";
import { validatePaymentSplit, splitTarget, emptyPartialState } from "@/components/forms/PaymentSplitRows";
import { isPTPackage } from "@/lib/utils";

interface RegistrationFormProps {
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

const STEP_LABELS = ["Personal", "Health", "Services", "Review"];

export function RegistrationForm({ mode, currentUser }: RegistrationFormProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");

  // One idempotency key per registration attempt-cycle — stable across
  // retries of the SAME submission (so a network retry or an accidental
  // double-click replays instead of duplicating), regenerated only when a
  // genuinely new registration starts (handleReset, or a fresh mount of
  // this form after a previous one succeeded and navigated away).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const [duplicateWarning, setDuplicateWarning] = useState<{ name: string; secondsAgo: number } | null>(null);

  const form = useForm<FullRegistrationData>({
    resolver: zodResolver(fullRegistrationSchema),
    defaultValues: {
      services_interested: [],
      gender: undefined,
    },
    mode: "onTouched",
  });

  async function handleNext() {
    const stepSchemas = [mode === "staff" ? step1StaffSchema : step1Schema, step2Schema, mode === "staff" ? step3StaffSchema : step3Schema];
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

      // Split-payment/partial-payment validation isn't expressed in the Zod
      // schema (kept imperative, same as the other two fee-collection
      // surfaces) — check it here so a bad split is caught before Review
      // rather than only at final submit.
      if (currentStep === 3 && mode === "staff") {
        const admissionFinal = calculateDiscount(Number(values.admission_fee) || 0, values.admission_discount_type, values.admission_discount_value).finalAmount;
        if (admissionFinal > 0) {
          const err = validatePaymentSplit(admissionFinal, values.admission_payment_lines ?? [], values.admission_partial ?? emptyPartialState);
          if (err) { toast.error(`Admission Fee: ${err}`); return; }
        }

        // One fetch of the selected packages serves both the per-package
        // Package Payment total (for split validation) and the PT check
        // below — packages are only known client-side in Step3Services, not
        // already available here.
        const packageIds = values.package_ids ?? [];
        const packageSelections = values.package_selections ?? [];
        let packagesFinal = 0;
        let hasPT = false;
        let pkgById = new Map<string, { id: string; name: string; monthly_fee: number | null }>();
        if (packageIds.length > 0) {
          const supabase = createClient();
          const { data: selectedPkgs } = await supabase.from("packages").select("id, name, monthly_fee").in("id", packageIds);
          pkgById = new Map((selectedPkgs ?? []).map((p) => [p.id, p]));
          hasPT = (selectedPkgs ?? []).some((p) => isPTPackage(p));
          // Personal Training packages have no discount step — the typed
          // price is the final amount directly.
          packagesFinal = packageSelections.reduce((sum, sel) => {
            const pkg = pkgById.get(sel.package_id);
            if (!pkg) return sum;
            if (isPTPackage(pkg)) return sum + (sel.custom_price ?? 0);
            return sum + calculateDiscount(pkg.monthly_fee ?? 0, sel.discount_type, sel.discount_value).finalAmount;
          }, 0);
        }

        if (packagesFinal > 0) {
          const err = validatePaymentSplit(packagesFinal, values.membership_payment_lines ?? [], values.membership_partial ?? emptyPartialState);
          if (err) { toast.error(`Package Payment: ${err}`); return; }
        }

        // Trainer, PT price, and trainer commission are all required once a
        // Personal Training package is selected — PT packages are exclusive
        // (Step3Services already enforces only one can be selected at a time
        // via auto-replace), so there's at most one PT selection to check.
        if (hasPT) {
          if (!values.trainer_id) {
            toast.error("Select a trainer — required when a Personal Training package is selected");
            form.setError("trainer_id", { message: "Trainer is required for Personal Training packages" });
            return;
          }
          const ptSelection = packageSelections.find((sel) => {
            const pkg = pkgById.get(sel.package_id);
            return pkg && isPTPackage(pkg);
          });
          if (!ptSelection?.custom_price || ptSelection.custom_price <= 0) {
            toast.error("Enter the Personal Training price — required when a Personal Training package is selected");
            return;
          }
          const commissionResult = buildCommissionPayload(
            values.commission_type ?? "percent",
            String(values.commission_percent ?? ""),
            String(values.commission_amount ?? "")
          );
          if (commissionResult.error) {
            toast.error(`Trainer commission: ${commissionResult.error}`);
            return;
          }
        }
      }
    }
    setCurrentStep((s) => Math.min(s + 1, 4));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Section 5: a WARNING only (never a hard block) — families legitimately
   *  share phone numbers. Flags an active member created very recently
   *  (10 min) whose normalized phone matches, so staff can catch an
   *  accidental resubmit-as-new-person before it happens, without
   *  stopping a second, genuinely different family member from being
   *  added on the same number. */
  async function findRecentDuplicate(phone: string): Promise<{ name: string; secondsAgo: number } | null> {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return null;
    const supabase = createClient();
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("members")
      .select("full_name, phone, created_at")
      .is("deleted_at", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false });
    const match = (data ?? []).find((m) => (m.phone ?? "").replace(/\D/g, "") === digits);
    if (!match) return null;
    return {
      name: match.full_name,
      secondsAgo: Math.max(0, Math.round((Date.now() - new Date(match.created_at as string).getTime()) / 1000)),
    };
  }

  async function handleSubmit(skipDuplicateCheck = false) {
    const values = form.getValues();
    if (!values.terms_agreed) {
      form.setError("terms_agreed", { message: "You must agree to the terms" });
      return;
    }

    if (mode === "staff" && !skipDuplicateCheck) {
      const dup = await findRecentDuplicate(values.phone);
      if (dup) {
        setDuplicateWarning(dup);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "staff") {
        // Staff registration → atomic member + initial payment, one call.
        // See /api/members/register and register_member_with_payment() —
        // this used to be several sequential client-side inserts, which is
        // exactly what let a mid-sequence failure leave a member created
        // with no fee recorded (the Mansoor/Moazen Bilal incidents).
        const supabase = createClient();
        const packageIds = values.package_ids ?? [];
        const { data: selectedPkgs } = packageIds.length > 0
          ? await supabase.from("packages").select("id, name, monthly_fee").in("id", packageIds)
          : { data: [] as { id: string; name: string; monthly_fee: number | null }[] };
        const pkgById = new Map((selectedPkgs ?? []).map((p) => [p.id, p]));
        const ptSelection = (values.package_selections ?? []).find((sel) => {
          const pkg = pkgById.get(sel.package_id);
          return pkg && isPTPackage(pkg);
        });

        let commission: Record<string, unknown> | null = null;
        if (ptSelection && values.trainer_id) {
          const commissionResult = buildCommissionPayload(
            values.commission_type ?? "percent",
            String(values.commission_percent ?? ""),
            String(values.commission_amount ?? "")
          );
          if (commissionResult.payload) {
            commission = { trainer_id: values.trainer_id, ...commissionResult.payload };
          }
        }

        const admissionCalc = calculateDiscount(
          Number(values.admission_fee) || 0,
          values.admission_discount_type,
          values.admission_discount_value
        );

        const packageBreakdown: PackageBreakdownItem[] = (values.package_selections ?? [])
          .map((sel) => {
            const pkg = pkgById.get(sel.package_id);
            if (!pkg) return null;
            if (isPTPackage(pkg)) {
              const price = sel.custom_price ?? 0;
              return {
                name: pkg.name,
                original: price,
                discount_type: "none" as const,
                discount_value: null,
                discount_amount: 0,
                final: price,
              };
            }
            const { discountAmount, finalAmount } = calculateDiscount(pkg.monthly_fee ?? 0, sel.discount_type, sel.discount_value);
            return {
              name: pkg.name,
              original: pkg.monthly_fee ?? 0,
              discount_type: sel.discount_type ?? "none",
              discount_value: sel.discount_value ?? null,
              discount_amount: discountAmount,
              final: finalAmount,
            };
          })
          .filter((item) => item !== null) as PackageBreakdownItem[];
        const membershipCalc = {
          discountAmount: packageBreakdown.reduce((sum, p) => sum + p.discount_amount, 0),
          finalAmount: packageBreakdown.length > 0
            ? packageBreakdown.reduce((sum, p) => sum + p.final, 0)
            : calculateDiscount(Number(values.monthly_fee) || 0, values.membership_discount_type, values.membership_discount_value).finalAmount,
        };

        let admissionPayment: Record<string, unknown> | null = null;
        if (admissionCalc.finalAmount > 0) {
          const note = admissionCalc.discountAmount > 0
            ? `Discount: ${formatPKR(admissionCalc.discountAmount)} (${Math.round((admissionCalc.discountAmount / (Number(values.admission_fee) || 1)) * 100)}% off original ${formatPKR(Number(values.admission_fee) || 0)})`
            : null;
          const admissionPartial = values.admission_partial ?? emptyPartialState;
          const admissionLines = values.admission_payment_lines?.length ? values.admission_payment_lines : [{ method: "Cash", amount: String(admissionCalc.finalAmount) }];
          const admissionCollected = splitTarget(admissionCalc.finalAmount, admissionPartial);
          const admissionBalanceDue = admissionPartial.isPartial ? Math.max(admissionCalc.finalAmount - admissionCollected, 0) : 0;
          admissionPayment = {
            final_amount: admissionCalc.finalAmount,
            discount_amount: admissionCalc.discountAmount,
            original_amount: Number(values.admission_fee) || 0,
            note,
            lines: admissionLines.map((l) => ({ method: l.method, amount: Number(l.amount) })),
            balance_due: admissionBalanceDue,
            balance_due_date: admissionBalanceDue > 0 ? admissionPartial.balanceDueDate : null,
          };
        }

        let membershipPayment: Record<string, unknown> | null = null;
        if (membershipCalc.finalAmount > 0) {
          const note = packageBreakdown.length > 0
            ? (packageBreakdown.some((p) => p.discount_amount > 0)
                ? `Package discounts: ${packageBreakdown.filter((p) => p.discount_amount > 0).map((p) => `${p.name} −${formatPKR(p.discount_amount)}`).join(", ")}`
                : null)
            : (membershipCalc.discountAmount > 0
                ? `Discount: ${formatPKR(membershipCalc.discountAmount)} (${Math.round((membershipCalc.discountAmount / (Number(values.monthly_fee) || 1)) * 100)}% off original ${formatPKR(Number(values.monthly_fee) || 0)})`
                : null);
          const membershipPartial = values.membership_partial ?? emptyPartialState;
          const membershipLines = values.membership_payment_lines?.length ? values.membership_payment_lines : [{ method: "Cash", amount: String(membershipCalc.finalAmount) }];
          const membershipCollected = splitTarget(membershipCalc.finalAmount, membershipPartial);
          const membershipBalanceDue = membershipPartial.isPartial ? Math.max(membershipCalc.finalAmount - membershipCollected, 0) : 0;
          membershipPayment = {
            final_amount: membershipCalc.finalAmount,
            discount_amount: membershipCalc.discountAmount,
            original_amount: Number(values.monthly_fee) || 0,
            note,
            lines: membershipLines.map((l) => ({ method: l.method, amount: Number(l.amount) })),
            balance_due: membershipBalanceDue,
            balance_due_date: membershipBalanceDue > 0 ? membershipPartial.balanceDueDate : null,
            coverage_start: values.joining_date || null,
            coverage_end: values.expiry_date || null,
            package_breakdown: packageBreakdown.length > 0 ? packageBreakdown : null,
          };
        }

        const res = await fetch("/api/members/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotency_key: idempotencyKeyRef.current,
            member: {
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
              membership_start_date: values.membership_start_date || values.joining_date || null,
              expiry_date: values.expiry_date || null,
              admission_fee: values.admission_fee || null,
              monthly_fee: values.monthly_fee || null,
              training_fee: ptSelection?.custom_price ?? null,
              is_family_member: !!values.is_family_member,
              family_primary_member_id: values.is_family_member ? (values.family_primary_member_id || null) : null,
              family_relationship: values.is_family_member ? (values.family_relationship || null) : null,
              family_notes: values.is_family_member ? (values.family_notes || null) : null,
            },
            admission_payment: admissionPayment,
            membership_payment: membershipPayment,
            commission,
          }),
        });
        const result = await res.json();
        if (!res.ok || result.error) {
          throw new Error(result.error || "Registration failed");
        }

        toast.success(`Member ${values.full_name} added! ID: ${result.membership_no}`);
        const receiptParams = new URLSearchParams();
        if (result.admission_payment_id) receiptParams.set("admission", result.admission_payment_id);
        if (result.membership_payment_id) receiptParams.set("membership", result.membership_payment_id);
        // A fresh key for whatever registration this staff member does
        // next — this one is now permanently tied to the member just
        // created (or recovered, if this was itself a replay).
        idempotencyKeyRef.current = crypto.randomUUID();
        router.push(`/dashboard/register/receipt/${result.member_id}?${receiptParams.toString()}`);
      } else {
        // Public registration → create submission for approval. Single
        // insert, no dependent follow-up writes, so the atomicity problem
        // this change addresses doesn't apply here.
        const supabase = createClient();
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
      // The real reason, not a generic "try again" — a vague message after
      // a failed submit is exactly what caused a member to be re-created
      // by hand in the incident this change fixes. With the new atomic
      // registration, a thrown error here means NO member was created.
      toast.error(err instanceof Error ? err.message : "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    form.reset();
    setCurrentStep(1);
    setSubmitted(false);
    setReferenceNo("");
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  // Success screen — staff mode navigates straight to the payment receipt
  // instead (see handleSubmit), so this is only ever reached in public mode.
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
          Registration Submitted!
        </h2>

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
      </div>
    );
  }

  return (
    <div>
      <ProgressBar currentStep={currentStep} totalSteps={4} labels={STEP_LABELS} onStepClick={setCurrentStep} />

      <div className="min-h-[400px]">
        {currentStep === 1 && <Step1Personal form={form} mode={mode} />}
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
          <Button type="button" onClick={() => handleSubmit()} loading={submitting}>
            <Send className="w-4 h-4" />
            {mode === "staff" ? "Create Member" : "Submit Registration"}
          </Button>
        )}
      </div>

      {/* Section 5: a warning, never a hard block — families legitimately
          share phone numbers, so this only asks staff to double-check. */}
      <Modal
        open={!!duplicateWarning}
        onClose={() => setDuplicateWarning(null)}
        title="Possible duplicate"
        size="sm"
      >
        {duplicateWarning && (
          <div className="space-y-4">
            <p className="text-sm text-[#4A4A44]">
              A member named <span className="font-semibold text-[#1A1A16]">{duplicateWarning.name}</span> with
              this phone number was created <span className="font-semibold">{duplicateWarning.secondsAgo}s ago</span>.
              Please verify before creating another record — this can happen if an earlier submission actually
              went through.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDuplicateWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDuplicateWarning(null);
                  handleSubmit(true);
                }}
              >
                Create Anyway
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
