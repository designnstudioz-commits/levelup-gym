import { z } from "zod";

const pkPhone = z
  .string()
  .regex(/^0\d{2,3}[-\s]?\d{7,8}$/, "Format: 0300-0000000");

const pkPhoneOptional = z
  .string()
  .optional()
  .refine((v) => !v || /^0\d{2,3}[-\s]?\d{7,8}$/.test(v), {
    message: "Format: 0300-0000000",
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
});

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

export const step3Schema = z.object({
  services_interested: z.array(z.string()).optional(),
  trainer_preference: z.string().optional(),
  nutritionist_preference: z.string().optional(),
  notes: z.string().optional(),
  // Staff section (optional for public mode)
  package_id: z.string().optional(),
  trainer_id: z.string().optional(),
  joining_date: z.string().optional(),
  expiry_date: z.string().optional(),
  admission_fee: z.number().optional(),
  monthly_fee: z.number().optional(),
  payment_method: z
    .enum(["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"])
    .optional(),
  handled_by: z.string().optional(),
});

export const step4Schema = z.object({
  terms_agreed: z.literal(true, { error: "You must agree to the terms" }),
});

export const fullRegistrationSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema.partial());

export type Step1Data = z.infer<typeof step1Schema>;
export type Step2Data = z.infer<typeof step2Schema>;
export type Step3Data = z.infer<typeof step3Schema>;
export type Step4Data = z.infer<typeof step4Schema>;
export type FullRegistrationData = z.infer<typeof fullRegistrationSchema>;
