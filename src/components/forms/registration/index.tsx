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
import { generateMembershipNo, generateReceiptNo, calculateDiscount, formatPKR, buildCommissionPayload } from "@/lib/utils";
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

        // Fetched up front (not just inside the payment section below) since
        // the PT custom price is also needed for members.training_fee on
        // the initial insert.
        const packageIds = values.package_ids ?? [];
        const { data: selectedPkgs } = packageIds.length > 0
          ? await supabase.from("packages").select("id, name, monthly_fee").in("id", packageIds)
          : { data: [] as { id: string; name: string; monthly_fee: number | null }[] };
        const pkgById = new Map((selectedPkgs ?? []).map((p) => [p.id, p]));
        const ptSelection = (values.package_selections ?? []).find((sel) => {
          const pkg = pkgById.get(sel.package_id);
          return pkg && isPTPackage(pkg);
        });

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
            // Negotiated Personal Training price specifically — separate
            // from monthly_fee, which is the sum across all packages.
            training_fee: ptSelection?.custom_price ?? null,
            status: values.is_family_member ? "pending_family_approval" : "active",
            family_primary_member_id: values.is_family_member ? (values.family_primary_member_id || null) : null,
            family_relationship: values.is_family_member ? (values.family_relationship || null) : null,
            family_notes: values.is_family_member ? (values.family_notes || null) : null,
          })
          .select("id")
          .single();

        if (error) throw error;

        // Log the activity
        await supabase.from("activity_logs").insert({
          user_id: currentUser?.id ?? null,
          action: "added_member",
          entity_type: "member",
          entity_id: data.id,
          description: `Added new member ${values.full_name} — ${membershipNo}${values.is_family_member ? " (pending family approval)" : ""}`,
          metadata: {
            membership_no: membershipNo,
            package_id: values.package_id,
            is_family_member: !!values.is_family_member,
            family_primary_member_id: values.family_primary_member_id ?? null,
          },
        });

        // Trainer commission — required at registration whenever a PT
        // package is selected (enforced in handleNext above), so this
        // should always succeed here; still guarded defensively.
        if (ptSelection && values.trainer_id) {
          const commissionResult = buildCommissionPayload(
            values.commission_type ?? "percent",
            String(values.commission_percent ?? ""),
            String(values.commission_amount ?? "")
          );
          if (commissionResult.payload) {
            const { error: commissionError } = await supabase.from("trainer_member_commissions").insert({
              trainer_id: values.trainer_id,
              member_id: data.id,
              ...commissionResult.payload,
              updated_by: currentUser?.id ?? null,
            });
            if (commissionError) throw commissionError;
          }
        }

        // Collect the member's first payment (admission + membership fee)
        // right here, rather than requiring a separate trip through Fees —
        // the member has already paid by the time this form is submitted.
        // joining_date/expiry_date are already correct on the member row
        // above (computed from package duration), so these inserts must NOT
        // call extendExpiryDate — that's only for later, recurring payments.
        const today = format(new Date(), "yyyy-MM-dd");
        const admissionCalc = calculateDiscount(
          Number(values.admission_fee) || 0,
          values.admission_discount_type,
          values.admission_discount_value
        );

        // Package Payment = sum of each selected package's own independent
        // discount (not one discount over the summed total) — build the
        // breakdown that gets persisted to fee_payments.package_breakdown
        // for the receipt. Personal Training packages skip the discount
        // step: the custom price typed in is the final amount directly.
        // (pkgById/ptSelection were fetched earlier, before the member insert.)
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

        let admissionPaymentId: string | null = null;
        let membershipPaymentId: string | null = null;

        // Sequential, not Promise.all — generateReceiptNo() reads the current
        // row count then writes one higher, with no DB uniqueness constraint,
        // so two calls back-to-back before either insert lands would return
        // the same receipt number (same class of race already fixed once in
        // this codebase for device_commands.command_id). Each fee type is
        // its own receipt_no group; within a group, a payment split across
        // methods produces one row per method, only the first carrying
        // balance_due for a partial payment.
        if (admissionCalc.finalAmount > 0) {
          const receiptNo = await generateReceiptNo();
          const note = admissionCalc.discountAmount > 0
            ? `Discount: ${formatPKR(admissionCalc.discountAmount)} (${Math.round((admissionCalc.discountAmount / (Number(values.admission_fee) || 1)) * 100)}% off original ${formatPKR(Number(values.admission_fee) || 0)})`
            : null;
          const admissionPartial = values.admission_partial ?? emptyPartialState;
          const admissionLines = values.admission_payment_lines?.length ? values.admission_payment_lines : [{ method: "Cash", amount: String(admissionCalc.finalAmount) }];
          const admissionCollected = splitTarget(admissionCalc.finalAmount, admissionPartial);
          const admissionBalanceDue = admissionPartial.isPartial ? Math.max(admissionCalc.finalAmount - admissionCollected, 0) : 0;

          const admissionRows = admissionLines.map((line, i) => ({
            member_id: data.id,
            amount: Number(line.amount),
            payment_type: "admission" as const,
            payment_method: line.method as any,
            payment_date: today,
            month_covered: null,
            receipt_no: receiptNo,
            note,
            balance_due: i === 0 ? admissionBalanceDue : 0,
            balance_due_date: i === 0 && admissionBalanceDue > 0 ? admissionPartial.balanceDueDate : null,
            collected_by: currentUser?.id ?? null,
          }));

          const { data: admissionPayments, error: payError } = await supabase
            .from("fee_payments")
            .insert(admissionRows)
            .select("id");

          if (payError) throw payError;
          admissionPaymentId = admissionPayments[0].id;

          await supabase.from("activity_logs").insert({
            user_id: currentUser?.id ?? null,
            action: "paid_fee",
            entity_type: "member",
            entity_id: data.id,
            description: `${values.full_name} paid ${formatPKR(admissionCollected)} (admission) — ${receiptNo}${admissionBalanceDue > 0 ? ` — ${formatPKR(admissionBalanceDue)} balance due` : ""}`,
            metadata: { original: Number(values.admission_fee) || 0, discount: admissionCalc.discountAmount, final: admissionCalc.finalAmount, collected: admissionCollected, balanceDue: admissionBalanceDue, receipt_no: receiptNo },
          });
        }

        if (membershipCalc.finalAmount > 0) {
          const receiptNo = await generateReceiptNo();
          // Structured package_breakdown (below) is the source of truth for
          // receipts when present; this note is just a plain-text fallback
          // summary, consistent with the old single-discount format for any
          // registration with no packages selected at all (monthly_fee set
          // by hand, no package_selections).
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

          const membershipRows = membershipLines.map((line, i) => ({
            member_id: data.id,
            amount: Number(line.amount),
            payment_type: "membership" as const,
            payment_method: line.method as any,
            payment_date: today,
            month_covered: today,
            receipt_no: receiptNo,
            note,
            balance_due: i === 0 ? membershipBalanceDue : 0,
            balance_due_date: i === 0 && membershipBalanceDue > 0 ? membershipPartial.balanceDueDate : null,
            package_breakdown: i === 0 && packageBreakdown.length > 0 ? packageBreakdown : null,
            collected_by: currentUser?.id ?? null,
          }));

          const { data: membershipPayments, error: payError } = await supabase
            .from("fee_payments")
            .insert(membershipRows)
            .select("id");

          if (payError) throw payError;
          membershipPaymentId = membershipPayments[0].id;

          await supabase.from("activity_logs").insert({
            user_id: currentUser?.id ?? null,
            action: "paid_fee",
            entity_type: "member",
            entity_id: data.id,
            description: `${values.full_name} paid ${formatPKR(membershipCollected)} (membership) — ${receiptNo}${membershipBalanceDue > 0 ? ` — ${formatPKR(membershipBalanceDue)} balance due` : ""}`,
            metadata: { original: Number(values.monthly_fee) || 0, discount: membershipCalc.discountAmount, final: membershipCalc.finalAmount, collected: membershipCollected, balanceDue: membershipBalanceDue, receipt_no: receiptNo },
          });
        }

        toast.success(`Member ${values.full_name} added! ID: ${membershipNo}`);
        const receiptParams = new URLSearchParams();
        if (admissionPaymentId) receiptParams.set("admission", admissionPaymentId);
        if (membershipPaymentId) receiptParams.set("membership", membershipPaymentId);
        router.push(`/dashboard/register/receipt/${data.id}?${receiptParams.toString()}`);
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
          <Button type="button" onClick={handleSubmit} loading={submitting}>
            <Send className="w-4 h-4" />
            {mode === "staff" ? "Create Member" : "Submit Registration"}
          </Button>
        )}
      </div>
    </div>
  );
}
