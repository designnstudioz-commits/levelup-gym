import { z } from "zod";

// Accepts a Pakistani local number (0300-0000000) or an international
// number (+<dial code> <grouped digits>, e.g. "+971 50 123 4567") —
// members/emergency contacts aren't always Pakistan-based.
const phoneRegex = /^(0\d{2,3}[-\s]?\d{7,8}|\+\d[\d\s-]{6,17})$/;

const pkPhone = z
  .string()
  .regex(phoneRegex, "Format: 0300-0000000 or +1 234 567 8900");

const pkPhoneOptional = z
  .string()
  .optional()
  .refine((v) => !v || phoneRegex.test(v), {
    message: "Format: 0300-0000000 or +1 234 567 8900",
  });

export const step1Schema = z.object({
  photo_url: z.string().optional(),
  full_name: z.string().min(2, "Full name is required"),
  secondary_name: z.string().optional(),
  dob: z
    .string()
    .optional()
    .refine((v) => {
      if (!v) return true;
      const year = parseInt(v.split("-")[0], 10);
      return !isNaN(year) && year >= 1900 && year <= new Date().getFullYear();
    }, "Please enter a valid year (e.g. 1990)"),
  age: z.number().optional(),
  gender: z.enum(["Male", "Female"], { error: "Please select gender" }),
  marital_status: z.enum(["Single", "Married"]).optional(),
  phone: pkPhone,
  whatsapp: pkPhoneOptional,
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  cnic: z
    .string()
    .regex(/^\d{5}-\d{7}-\d$/, "Format: XXXXX-XXXXXXX-X")
    .optional()
    .or(z.literal("")),
  address: z.string().optional(),
  referral_source: z.string().optional(),
  referred_by: z.string().optional(),
  // Family membership — staff-mode only (see step1StaffSchema below).
  // Checking "Register as Family Member" links this new member to an
  // existing primary member; pricing is decided later by an Owner/Manager
  // on /dashboard/family-approvals, not here — this just captures the link.
  is_family_member: z.boolean().optional(),
  family_primary_member_id: z.string().optional(),
  family_relationship: z.string().optional(),
  family_notes: z.string().optional(),
});

// Staff-only requirement: if "Register as Family Member" is checked, the
// primary member and relationship must be filled in. Kept as a separate
// export (not chained onto step1Schema itself) because .refine() returns a
// ZodEffects, not a ZodObject, and fullRegistrationSchema below relies on
// .merge() across all four step schemas — same pattern already used for
// step3StaffSchema vs step3Schema.
export const step1StaffSchema = step1Schema.refine(
  (data) => !data.is_family_member || (!!data.family_primary_member_id && !!data.family_relationship),
  { message: "Select the primary member and relationship for a family member", path: ["family_relationship"] }
);

export const step2Schema = z.object({
  height: z.string().optional(),
  weight: z.string().optional(),
  blood_group: z.string().optional(),
  vaccinated: z.string().optional(),
  injuries: z.string().optional(),
  medical_notes: z.string().optional(),
  documents: z.array(z.string()).optional(),
  emergency_name: z.string().min(2, "Emergency contact name is required"),
  emergency_relation: z.string().optional(),
  emergency_phone: pkPhone,
});

const discountTypeSchema = z.enum(["none", "percent", "amount"]).optional();

// A single payment line ({method, amount}) and the "pay part now, owe the
// rest by a date" state — one of each per fee section (admission,
// membership), matching the shared PaymentSplitRows component. Left loosely
// typed here (not deeply refined) since the real split/partial validation
// runs imperatively via validatePaymentSplit() in index.tsx, the same way
// the other two fee-collection surfaces (member profile, Fees page) do it —
// keeps all three consistent rather than duplicating that logic into Zod.
const paymentLineSchema = z.object({ method: z.string(), amount: z.string() });
const partialPaymentSchema = z.object({
  isPartial: z.boolean(),
  amountReceivedNow: z.string(),
  balanceDueDate: z.string(),
});

// One entry per selected package — each package gets its own independent
// discount (Package Payment no longer applies one discount to the summed
// total). Kept alongside package_ids (which still just holds the plain id
// list for the members.package_ids column) rather than replacing it.
const packageSelectionSchema = z.object({
  package_id: z.string(),
  discount_type: discountTypeSchema,
  discount_value: z.number().optional(),
});

export const step3Schema = z.object({
  services_interested: z.array(z.string()).optional(),
  trainer_preference: z.string().optional(),
  nutritionist_preference: z.string().optional(),
  notes: z.string().optional(),
  // Staff section (optional for public mode)
  package_ids: z.array(z.string()).optional(),
  package_id: z.string().optional(),
  // Per-package discount — see packageSelectionSchema above. Replaces
  // membership_discount_type/value (kept below, declared but unused by new
  // code) as the source of truth for the Package Payment total.
  package_selections: z.array(packageSelectionSchema).optional(),
  trainer_id: z.string().optional(),
  joining_date: z.string().optional(),
  expiry_date: z.string().optional(),
  admission_fee: z.number().optional(),
  monthly_fee: z.number().optional(),
  // Discount applied to admission_fee / monthly_fee when staff collect the
  // member's first payment at registration — unused/optional in public mode.
  admission_discount_type: discountTypeSchema,
  admission_discount_value: z.number().optional(),
  membership_discount_type: discountTypeSchema,
  membership_discount_value: z.number().optional(),
  // Split payment methods + partial payment, one set per fee section.
  admission_payment_lines: z.array(paymentLineSchema).optional(),
  admission_partial: partialPaymentSchema.optional(),
  membership_payment_lines: z.array(paymentLineSchema).optional(),
  membership_partial: partialPaymentSchema.optional(),
  handled_by: z.string().optional(),
});

// Staff registrations create a member directly (skipping the approval
// queue), so joining_date must be set — otherwise expiry_date is left null
// at creation, and whatever fee payment comes in first silently becomes the
// basis for expiry instead of the member's actual joining date.
//
// Staff registrations also collect the member's first payment on the spot
// (admission + membership fee, each with its own optional discount and
// split/partial payment) — at least one fee amount must be > 0. The actual
// payment-method/split validation happens imperatively in index.tsx.
export const step3StaffSchema = step3Schema
  .extend({
    joining_date: z.string().min(1, "Joining date is required"),
  })
  .refine((data) => (Number(data.admission_fee) || 0) > 0 || (Number(data.monthly_fee) || 0) > 0, {
    message: "Enter at least one fee amount to record a payment",
    path: ["monthly_fee"],
  });

export const step4Schema = z.object({
  terms_agreed: z.literal(true, { error: "You must agree to the terms" }),
});

export const fullRegistrationSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema.partial());

export type PackageSelection = z.infer<typeof packageSelectionSchema>;
export type Step1Data = z.infer<typeof step1Schema>;
export type Step2Data = z.infer<typeof step2Schema>;
export type Step3Data = z.infer<typeof step3Schema>;
export type Step4Data = z.infer<typeof step4Schema>;
export type FullRegistrationData = z.infer<typeof fullRegistrationSchema>;
