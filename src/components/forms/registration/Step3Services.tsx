"use client";

import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn, calculateDiscount, formatPKR, isPTPackage } from "@/lib/utils";
import type { FullRegistrationData, PackageSelection } from "@/lib/validations/registration";
import type { Package, StaffMember, SystemUser } from "@/types/database";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addMonths, format } from "date-fns";
import { Minus, Dumbbell } from "lucide-react";
import { PaymentSplitRows, emptyPartialState, type PaymentLine, type PartialPaymentState } from "@/components/forms/PaymentSplitRows";

interface Step3Props {
  form: UseFormReturn<FullRegistrationData>;
  mode: "public" | "staff";
  currentUser?: SystemUser | null;
}

// Shared discount box for the Admission/Membership fee sections below —
// same 3-button discount-type toggle + breakdown as the Fees page's
// "Special Discount" box, kept local to this file since it's only used here.
function FeeDiscountBox({
  title, badge, original, onOriginalChange, discountType, discountValue, onDiscountTypeChange, onDiscountValueChange, bordered = true,
}: {
  title: string;
  /** Small pill next to the title — used for the "PT" marker on Personal
   *  Training packages in the per-package Package Payment list. */
  badge?: React.ReactNode;
  original: number;
  onOriginalChange?: (value: number) => void;
  discountType: "none" | "percent" | "amount";
  discountValue: number | undefined;
  onDiscountTypeChange: (value: "none" | "percent" | "amount") => void;
  onDiscountValueChange: (value: number | undefined) => void;
  /** false when nested inside an outer bordered section (registration's
   *  numbered Admission/Membership blocks) so it doesn't double-border. */
  bordered?: boolean;
}) {
  const { discountAmount, finalAmount } = calculateDiscount(original, discountType, discountValue);

  return (
    <div className={bordered ? "rounded-xl border border-[#E4E4DE] bg-white p-4 space-y-3" : "space-y-3"}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-[#1A1A16] flex items-center gap-1.5">{title}{badge}</p>
        {onOriginalChange ? (
          <input
            type="number"
            value={original || ""}
            onChange={(e) => onOriginalChange(Number(e.target.value) || 0)}
            className="w-32 text-right text-sm font-semibold px-2 py-1 rounded-lg border border-[#E4E4DE] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
          />
        ) : (
          <span className="text-sm font-semibold text-[#1A1A16]">{formatPKR(original)}</span>
        )}
      </div>

      <div className="flex gap-2">
        {(["none", "percent", "amount"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => { onDiscountTypeChange(opt); onDiscountValueChange(undefined); }}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all",
              discountType === opt ? "bg-[#F06418] text-white border-[#F06418]" : "bg-white text-[#4A4A44] border-[#E4E4DE] hover:border-[#F06418]"
            )}
          >
            {opt === "none" ? "No Discount" : opt === "percent" ? "% Percentage" : "Rs Amount"}
          </button>
        ))}
      </div>

      {discountType !== "none" && (
        <Input
          label={discountType === "percent" ? "Discount %" : "Discount Amount (Rs)"}
          type="number"
          placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 500"}
          value={discountValue ?? ""}
          onChange={(e) => onDiscountValueChange(e.target.value ? Number(e.target.value) : undefined)}
        />
      )}

      {discountType !== "none" && discountAmount > 0 && (
        <div className="bg-[#F8F8F6] rounded-lg border border-[#E4E4DE] p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-[#4A4A44]">Original</span>
            <span className="font-medium">{formatPKR(original)}</span>
          </div>
          <div className="flex justify-between text-sm text-[#F06418]">
            <span className="flex items-center gap-1"><Minus className="w-3 h-3" /> Discount</span>
            <span className="font-medium">− {formatPKR(discountAmount)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold pt-1 border-t border-[#E4E4DE]">
            <span>Collect</span><span className="text-green-700">{formatPKR(finalAmount)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Step3Services({ form, mode, currentUser }: Step3Props) {
  const { register, watch, setValue, formState: { errors } } = form;
  const [packages, setPackages] = useState<Package[]>([]);
  const [trainers, setTrainers] = useState<StaffMember[]>([]);

  const joiningDate        = watch("joining_date");
  const selectedPackageIds = watch("package_ids") ?? [];
  const packageSelections: PackageSelection[] = watch("package_selections") ?? [];
  const admissionFee              = watch("admission_fee") ?? 0;
  const admissionDiscountType     = watch("admission_discount_type") ?? "none";
  const admissionDiscountValue    = watch("admission_discount_value");
  const admissionLines: PaymentLine[]    = watch("admission_payment_lines") ?? [{ method: "Cash", amount: "" }];
  const admissionPartial: PartialPaymentState  = watch("admission_partial") ?? emptyPartialState;
  const membershipLines: PaymentLine[]   = watch("membership_payment_lines") ?? [{ method: "Cash", amount: "" }];
  const membershipPartial: PartialPaymentState = watch("membership_partial") ?? emptyPartialState;

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("packages")
      .select("*")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("monthly_fee", { ascending: true })
      .then(({ data }) => setPackages(data ?? []));

    supabase
      .from("staff_members")
      .select("*")
      .eq("role", "Trainer")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("full_name")
      .then(({ data }) => setTrainers(data ?? []));

    if (mode === "staff" && currentUser) {
      setValue("handled_by", currentUser.id);
    }
  }, [mode, currentUser, setValue]);

  // Auto-calculate expiry from joining date + the longest selected package's
  // duration, so combining a short add-on with a longer plan doesn't cut the
  // member short. Recomputes whenever either input changes; staff can still
  // hand-edit the result afterward, but doing so again after changing the
  // joining date or package selection will recompute over it.
  useEffect(() => {
    if (joiningDate) {
      const durationMonths = selectedPackageIds.reduce((max, id) => {
        const pkg = packages.find((p) => p.id === id);
        return Math.max(max, pkg?.duration_months ?? 1);
      }, 1);
      const expiry = format(addMonths(new Date(joiningDate), durationMonths), "yyyy-MM-dd");
      setValue("expiry_date", expiry);
    }
  }, [joiningDate, selectedPackageIds, packages, setValue]);

  // Recalculate total monthly fee whenever selected packages OR their
  // per-package selections (discount / PT custom price) change.
  useEffect(() => {
    if (!packages.length) return;
    const total = selectedPackageIds.reduce((sum, id) => {
      const pkg = packages.find((p) => p.id === id);
      if (!pkg) return sum;
      const sel = packageSelections.find((s) => s.package_id === id) ?? { package_id: id, discount_type: "none" as const, discount_value: undefined };
      return sum + (isPTPackage(pkg) ? (sel.custom_price ?? 0) : (pkg.monthly_fee ?? 0));
    }, 0);
    setValue("monthly_fee", total);
    setValue("package_id", selectedPackageIds[0] ?? undefined);
  }, [selectedPackageIds, packageSelections, packages, setValue]);

  // Admission fee defaults from the selected packages' own admission_fee
  // (not a hardcoded number — it's a real, independently-editable column per
  // package). Same recompute-but-overridable convention as expiry_date /
  // monthly_fee above: staff can still hand-edit it afterward.
  useEffect(() => {
    if (mode !== "staff" || !packages.length) return;
    const fromPackages = selectedPackageIds.reduce((max, id) => {
      const pkg = packages.find((p) => p.id === id);
      return Math.max(max, pkg?.admission_fee ?? 0);
    }, 0);
    setValue("admission_fee", fromPackages || 15000);
  }, [mode, selectedPackageIds, packages, setValue]);

  function selectionFor(pkgId: string): PackageSelection {
    return packageSelections.find((s) => s.package_id === pkgId) ?? { package_id: pkgId, discount_type: "none", discount_value: undefined };
  }

  // Personal Training packages have no catalog price — the price staff type
  // in is the final amount directly, no discount step. Regular packages
  // keep the existing original+discount+final calculation.
  function packageFinalAmount(pkg: Package, sel: PackageSelection): number {
    if (isPTPackage(pkg)) return sel.custom_price ?? 0;
    return calculateDiscount(pkg.monthly_fee ?? 0, sel.discount_type, sel.discount_value).finalAmount;
  }

  // Reads/writes via form.getValues() rather than the render-time
  // `packageSelections` closure — the discount-type buttons below fire two
  // updates back-to-back in one click handler (type, then value reset), and
  // setValue() doesn't update the closure until the next render, so the
  // second call would otherwise clobber the first with stale data.
  // getValues() always reflects the latest setValue() synchronously.
  function updatePackageSelection(pkgId: string, patch: Partial<Pick<PackageSelection, "discount_type" | "discount_value" | "custom_price">>) {
    const current = form.getValues("package_selections") ?? [];
    const sel = current.find((s) => s.package_id === pkgId) ?? { package_id: pkgId, discount_type: "none" as const, discount_value: undefined };
    setValue("package_selections", [
      ...current.filter((s) => s.package_id !== pkgId),
      { ...sel, ...patch },
    ]);
  }

  // PT packages are exclusive — selecting a new one auto-replaces whichever
  // PT package was already selected (confirmed decision: replace, not
  // block). Regular packages have no cap.
  function togglePackage(pkgId: string) {
    const pkg = packages.find((p) => p.id === pkgId);
    if (!pkg) return;

    if (selectedPackageIds.includes(pkgId)) {
      setValue("package_ids", selectedPackageIds.filter((id) => id !== pkgId));
      setValue("package_selections", packageSelections.filter((s) => s.package_id !== pkgId));
      return;
    }

    if (isPTPackage(pkg)) {
      const otherPT = selectedPackageIds.find((id) => {
        const p = packages.find((pp) => pp.id === id);
        return p && isPTPackage(p);
      });
      const idsWithoutOldPT = otherPT ? selectedPackageIds.filter((id) => id !== otherPT) : selectedPackageIds;
      setValue("package_ids", [...idsWithoutOldPT, pkgId]);
      setValue("package_selections", [
        ...packageSelections.filter((s) => s.package_id !== otherPT),
        { package_id: pkgId, discount_type: "none", discount_value: undefined },
      ]);
      if (otherPT) {
        const oldName = packages.find((p) => p.id === otherPT)?.name ?? "the previous Personal Training package";
        toast.info(`Replaced ${oldName} with ${pkg.name} — only one Personal Training package at a time`);
      }
      return;
    }

    setValue("package_ids", [...selectedPackageIds, pkgId]);
    setValue("package_selections", [...packageSelections, { package_id: pkgId, discount_type: "none", discount_value: undefined }]);
  }

  const admissionFinalAmount = calculateDiscount(admissionFee, admissionDiscountType, admissionDiscountValue).finalAmount;

  // Package Payment total = sum of each selected package's own independent
  // discount (not one discount over the summed total, per confirmed
  // requirement). One combined PaymentSplitRows below still collects this
  // as a single transaction — no package × payment-method row explosion.
  // Personal Training packages skip the discount step entirely — the price
  // typed in is the final amount directly (see packageFinalAmount above).
  const packageBreakdown = selectedPackageIds
    .map((id) => {
      const pkg = packages.find((p) => p.id === id);
      if (!pkg) return null;
      const sel = selectionFor(id);
      const finalAmount = packageFinalAmount(pkg, sel);
      const discountAmount = isPTPackage(pkg) ? 0 : calculateDiscount(pkg.monthly_fee ?? 0, sel.discount_type, sel.discount_value).discountAmount;
      return { id, pkg, sel, discountAmount, finalAmount };
    })
    .filter((item) => item !== null) as { id: string; pkg: Package; sel: PackageSelection; discountAmount: number; finalAmount: number }[];
  const packagesFinalTotal = packageBreakdown.reduce((sum, p) => sum + p.finalAmount, 0);
  const hasPTSelected = selectedPackageIds.some((id) => {
    const pkg = packages.find((p) => p.id === id);
    return pkg && isPTPackage(pkg);
  });

  // Personal Training gets its own dedicated section (package tier, trainer,
  // price, commission all together) instead of being mixed into the regular
  // package grid — it needs a fundamentally different flow (no discount step,
  // requires a trainer + commission) so it reads as one clear sequence.
  const regularPackages = packages.filter((p) => !isPTPackage(p));
  const ptPackages = packages.filter((p) => isPTPackage(p));
  const regularSelectedIds = selectedPackageIds.filter((id) => regularPackages.some((p) => p.id === id));
  const selectedTrainerId = watch("trainer_id") ?? "";
  const ptSelection = packageBreakdown.find((p) => isPTPackage(p.pkg))?.sel;
  const ptPrice = ptSelection?.custom_price ?? 0;
  const commissionType = watch("commission_type") ?? "percent";
  const commissionPercent = watch("commission_percent") ?? 0;
  const commissionAmount = watch("commission_amount") ?? 0;
  const commissionPreview = commissionType === "percent"
    ? ptPrice * (commissionPercent / 100)
    : commissionAmount;

  // ── Public mode ───────────────────────────────────────────────────────
  if (mode === "public") {
    const selectedServices = watch("services_interested") ?? [];

    function toggleService(name: string) {
      const updated = selectedServices.includes(name)
        ? selectedServices.filter((s) => s !== name)
        : [...selectedServices, name];
      setValue("services_interested", updated);
    }

    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-[#1A1A16] mb-1">
            Which services are you interested in?
          </p>
          <p className="text-xs text-[#7A7A72] mb-4">
            Select all that apply — our staff will confirm details and pricing when they contact you.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {packages.map((pkg) => {
              const selected = selectedServices.includes(pkg.name);
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => toggleService(pkg.name)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                    selected
                      ? "bg-[#FEF0E8] border-[#F06418]"
                      : "bg-white border-[#E4E4DE] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                  )}
                >
                  <span className={cn("text-sm font-semibold leading-tight", selected ? "text-[#C04E10]" : "text-[#1A1A16]")}>
                    {pkg.name}
                  </span>
                  {pkg.monthly_fee != null && pkg.monthly_fee > 0 && (
                    <span className={cn("text-xs font-medium", selected ? "text-[#F06418]" : "text-[#7A7A72]")}>
                      Rs {pkg.monthly_fee.toLocaleString()}/mo
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedServices.length > 0 && (
            <p className="text-xs text-[#F06418] mt-3 font-medium">
              {selectedServices.length} service{selectedServices.length !== 1 ? "s" : ""} selected
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Staff mode ────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Services multi-select — regular packages only. Personal Training
          gets its own dedicated section below since it needs a trainer,
          custom price, and commission, not a discount. */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-[#1A1A16]">Choose Interested Services</h3>
          {regularSelectedIds.length > 0 && (
            <span className="text-xs text-[#7A7A72]">{regularSelectedIds.length} selected</span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {regularPackages.map((pkg) => {
            const selected = selectedPackageIds.includes(pkg.id);
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => togglePackage(pkg.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                  selected
                    ? "bg-[#FEF0E8] border-[#F06418]"
                    : "bg-white border-[#E4E4DE] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                )}
              >
                <span className={cn("text-sm font-semibold leading-tight", selected ? "text-[#C04E10]" : "text-[#1A1A16]")}>
                  {pkg.name}
                </span>
                <span className={cn("text-xs font-medium", selected ? "text-[#F06418]" : "text-[#7A7A72]")}>
                  {pkg.monthly_fee != null ? `Rs ${pkg.monthly_fee.toLocaleString()}/mo` : "Custom pricing"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Fee breakdown */}
        {regularSelectedIds.length > 0 && (
          <div className="mt-3 bg-[#FEF0E8] border border-[#FDDCC8] rounded-lg p-3">
            <div className="space-y-1 mb-2">
              {regularSelectedIds.map((id) => {
                const pkg = packages.find((p) => p.id === id);
                if (!pkg) return null;
                return (
                  <div key={id} className="flex items-center justify-between text-xs text-[#4A4A44]">
                    <span>{pkg.name}</span>
                    <span className="font-semibold">Rs {(pkg.monthly_fee ?? 0).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[#FDDCC8]">
              <span className="text-sm font-semibold text-[#1A1A16]">Total Monthly</span>
              <span className="text-lg font-bold text-[#F06418]">
                Rs {regularSelectedIds.reduce((sum, id) => sum + (packages.find((p) => p.id === id)?.monthly_fee ?? 0), 0).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Personal Training — one dedicated section covering the whole
          flow: pick a tier, then trainer, then price, then commission each
          reveal in sequence, so it reads as one clear path instead of being
          scattered across the form. All of it (price → members.training_fee,
          commission → trainer_member_commissions) saves on final submit and
          shows up on both this member's profile and the trainer's assigned
          list — see index.tsx's handleSubmit. */}
      <div className="rounded-xl border-2 border-[#F06418] bg-white p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-4 h-4 text-[#F06418]" />
          <h3 className="text-base font-bold text-[#1A1A16]">Personal Training</h3>
          <span className="text-xs font-normal text-[#7A7A72]">(optional)</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ptPackages.map((pkg) => {
            const selected = selectedPackageIds.includes(pkg.id);
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => togglePackage(pkg.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                  selected
                    ? "bg-[#FEF0E8] border-[#F06418]"
                    : "bg-white border-[#E4E4DE] hover:border-[#F06418] hover:bg-[#FEF0E8]"
                )}
              >
                <span className={cn("text-sm font-semibold leading-tight", selected ? "text-[#C04E10]" : "text-[#1A1A16]")}>
                  {pkg.name}
                </span>
                <span className={cn("text-xs font-medium", selected ? "text-[#F06418]" : "text-[#7A7A72]")}>
                  Custom pricing
                </span>
              </button>
            );
          })}
        </div>

        {/* Step 2: trainer — revealed once a tier is picked */}
        {hasPTSelected && (
          <div className="pt-3 border-t border-[#FDDCC8]">
            <Select
              label="Assigned Trainer"
              required
              placeholder="Select trainer"
              error={errors.trainer_id?.message}
              value={selectedTrainerId}
              onChange={(e) => setValue("trainer_id", e.target.value, { shouldValidate: true })}
            >
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </Select>
            <p className="text-xs text-[#F06418] mt-1">Required — a Personal Training package is selected.</p>
          </div>
        )}

        {/* Step 3: price — revealed once a trainer is picked */}
        {hasPTSelected && selectedTrainerId && (
          <div className="pt-3 border-t border-[#FDDCC8]">
            <Input
              label="Personal Training Price (Rs)"
              type="number"
              required
              placeholder="e.g. 25000"
              value={ptPrice || ""}
              onChange={(e) => {
                const ptPkgId = selectedPackageIds.find((id) => {
                  const pkg = packages.find((p) => p.id === id);
                  return pkg && isPTPackage(pkg);
                });
                if (ptPkgId) updatePackageSelection(ptPkgId, { custom_price: e.target.value ? Number(e.target.value) : undefined });
              }}
            />
          </div>
        )}

        {/* Step 4: commission — revealed once a price is entered */}
        {hasPTSelected && selectedTrainerId && ptPrice > 0 && (
          <div className="pt-3 border-t border-[#FDDCC8] space-y-2">
            <p className="text-xs font-bold text-[#C04E10] uppercase tracking-wide">Trainer Commission</p>
            <div className="flex items-center gap-2">
              <select
                value={commissionType}
                onChange={(e) => setValue("commission_type", e.target.value as "percent" | "fixed", { shouldValidate: true })}
                className="flex-shrink-0 text-sm px-2 py-2 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              >
                <option value="percent">% Percentage</option>
                <option value="fixed">Rs Fixed Amount</option>
              </select>
              <div className="flex-1">
                {commissionType === "percent" ? (
                  <input
                    type="number" min={0} max={100}
                    placeholder="e.g. 30"
                    value={commissionPercent || ""}
                    onChange={(e) => setValue("commission_percent", e.target.value ? Number(e.target.value) : undefined, { shouldValidate: true })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                  />
                ) : (
                  <input
                    type="number" min={0}
                    placeholder="e.g. 3000"
                    value={commissionAmount || ""}
                    onChange={(e) => setValue("commission_amount", e.target.value ? Number(e.target.value) : undefined, { shouldValidate: true })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                  />
                )}
              </div>
            </div>
            <p className="text-xs text-[#F06418]">Required — set the trainer's commission for this Personal Training member.</p>

            {/* Step 5: live commission preview, once a value is entered */}
            {commissionPreview > 0 && (
              <div className="bg-[#F8F8F6] rounded-lg border border-[#E4E4DE] px-3 py-2.5">
                <p className="text-xs text-[#4A4A44]">
                  Trainer earns <span className="font-bold text-[#F06418]">{formatPKR(commissionPreview)}</span> per qualifying payment
                  {commissionType === "percent" && (
                    <span className="text-[#7A7A72]"> ({commissionPercent}% of {formatPKR(ptPrice)})</span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Enrollment details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E4E4DE]">
        <Input
          label="Joining Date"
          type="date"
          required
          error={errors.joining_date?.message}
          {...register("joining_date")}
        />
        <Input
          label="Expiry Date"
          type="date"
          {...register("expiry_date")}
          hint="Auto-calculated from joining date + package duration — adjust if needed"
        />
      </div>

      {/* Payment collection — the member pays now, so this records the actual
          fee_payments on submit rather than just a reference number. */}
      <div className="pt-2 border-t border-[#E4E4DE] space-y-3">
        <h3 className="text-base font-bold text-[#1A1A16]">Collect Payment</h3>

        {/* Each fee type is its own numbered, tinted card — admission and
            membership are separate transactions (separate receipts, separate
            optional partial payment), so they need to read as clearly
            distinct groups rather than a continuous stream of fields. */}
        <div className="rounded-xl border-2 border-[#FDDCC8] bg-[#FEF0E8] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#F06418] text-white text-[11px] font-bold flex-shrink-0">1</span>
            <h4 className="text-xs font-bold text-[#C04E10] uppercase tracking-wide">Admission Payment</h4>
          </div>
          <FeeDiscountBox
            bordered={false}
            title="Admission Fee"
            original={admissionFee}
            onOriginalChange={(v) => setValue("admission_fee", v)}
            discountType={admissionDiscountType}
            discountValue={admissionDiscountValue}
            onDiscountTypeChange={(v) => setValue("admission_discount_type", v)}
            onDiscountValueChange={(v) => setValue("admission_discount_value", v)}
          />
          {admissionFinalAmount > 0 && (
            <div className="pt-3 border-t border-[#FDDCC8]">
              <PaymentSplitRows
                fullAmount={admissionFinalAmount}
                lines={admissionLines}
                onLinesChange={(lines) => setValue("admission_payment_lines", lines)}
                partial={admissionPartial}
                onPartialChange={(partial) => setValue("admission_partial", partial)}
              />
            </div>
          )}
        </div>

        <div className="rounded-xl border-2 border-[#E4E4DE] bg-[#F8F8F6] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#1A1A16] text-white text-[11px] font-bold flex-shrink-0">2</span>
            <h4 className="text-xs font-bold text-[#1A1A16] uppercase tracking-wide">Package Payment</h4>
          </div>

          {/* Each selected package gets its own independent discount — no
              single discount over the summed total. Personal Training
              packages have no catalog price, so they skip the discount step
              entirely: staff type one number and that's the final price. */}
          {packageBreakdown.length === 0 ? (
            <p className="text-xs text-[#7A7A72]">Select a package above to collect payment for it.</p>
          ) : (
            <div className="space-y-3">
              {packageBreakdown.map(({ id, pkg, sel }) => (
                <div key={id} className="rounded-lg border border-[#E4E4DE] bg-white p-3">
                  {isPTPackage(pkg) ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-[#1A1A16] flex items-center gap-1.5">
                        {pkg.name}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8]">PT</span>
                      </p>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-[#1A1A16]">{formatPKR(sel.custom_price ?? 0)}</span>
                        <p className="text-[10px] text-[#7A7A72]">Set in the Personal Training section above</p>
                      </div>
                    </div>
                  ) : (
                    <FeeDiscountBox
                      bordered={false}
                      title={pkg.name}
                      original={pkg.monthly_fee ?? 0}
                      discountType={sel.discount_type ?? "none"}
                      discountValue={sel.discount_value}
                      onDiscountTypeChange={(v) => updatePackageSelection(id, { discount_type: v })}
                      onDiscountValueChange={(v) => updatePackageSelection(id, { discount_value: v })}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {packagesFinalTotal > 0 && (
            <div className="pt-3 border-t border-[#E4E4DE]">
              <PaymentSplitRows
                fullAmount={packagesFinalTotal}
                lines={membershipLines}
                onLinesChange={(lines) => setValue("membership_payment_lines", lines)}
                partial={membershipPartial}
                onPartialChange={(partial) => setValue("membership_partial", partial)}
              />
            </div>
          )}
        </div>

        <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-[#4A4A44]">Grand Total Collecting</span>
          <span className="text-xl font-bold text-[#1A1A16]">
            {formatPKR(admissionFinalAmount + packagesFinalTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
