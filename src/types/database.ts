export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberStatus = "active" | "inactive" | "archived" | "frozen";
export type SubmissionStatus = "pending" | "approved" | "rejected";
export type PackageType = "Individual" | "Family" | "Couple" | "Daily";
export type PaymentMethod = "Cash" | "Bank" | "Card" | "EasyPaisa" | "JazzCash";
export type SystemRole = "owner" | "manager" | "receptionist" | "trainer" | "viewer";
export type StaffRole = "Trainer" | "Receptionist" | "Manager" | "Nutritionist" | "Other";
export type PunchType = "in" | "out" | "unknown";
export type SmsStatus = "queued" | "sent" | "failed";

export interface Package {
  id: string;
  name: string;
  type: PackageType | null;
  duration_months: number;
  admission_fee: number;
  monthly_fee: number;
  max_members: number;
  description: string | null;
  services_included: string[] | null;
  training_sessions: number | null;
  color: string | null;
  is_featured: boolean;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface StaffMember {
  id: string;
  full_name: string;
  role: StaffRole | null;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  salary: number | null;
  joining_date: string | null;
  specialization: string | null;
  photo_url: string | null;
  bio: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SystemUser {
  id: string;
  staff_id: string | null;
  full_name: string;
  email: string;
  role: SystemRole | null;
  status: "active" | "inactive";
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Submission {
  id: string;
  // Personal
  full_name: string;
  secondary_name: string | null;
  dob: string | null;
  age: number | null;
  gender: "Male" | "Female" | null;
  marital_status: "Single" | "Married" | null;
  // Contact
  phone: string;
  whatsapp: string | null;
  email: string | null;
  cnic: string | null;
  address: string | null;
  // Referral
  referral_source: string | null;
  referred_by: string | null;
  // Physical
  height: string | null;
  weight: string | null;
  blood_group: string | null;
  vaccinated: string | null;
  injuries: string | null;
  medical_notes: string | null;
  // Emergency
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  // Services
  services_interested: string[] | null;
  notes: string | null;
  photo_url: string | null;
  // Official
  package_id: string | null;
  trainer_id: string | null;
  joining_date: string | null;
  expiry_date: string | null;
  admission_fee: number | null;
  monthly_fee: number | null;
  payment_method: PaymentMethod | null;
  handled_by: string | null;
  // Workflow
  status: SubmissionStatus;
  rejection_reason: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // Standard
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SubmissionWithJoins extends Submission {
  package?: Package | null;
  trainer?: StaffMember | null;
  handler?: SystemUser | null;
}

export interface Device {
  id: string;
  serial_no: string;
  name: string;
  location: string | null;
  door_type: string | null;
  color: string | null;
  ip_address: string | null;
  status: "active" | "inactive";
  last_seen: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  submission_id: string | null;
  membership_no: string;
  ref_id: string | null;
  // Personal
  full_name: string;
  secondary_name: string | null;
  dob: string | null;
  age: number | null;
  gender: string | null;
  marital_status: string | null;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  cnic: string | null;
  address: string | null;
  blood_group: string | null;
  vaccinated: string | null;
  height: string | null;
  weight: string | null;
  medical_notes: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  photo_url: string | null;
  // Membership
  package_id: string | null;
  trainer_id: string | null;
  nutritionist_id: string | null;
  joining_date: string | null;
  expiry_date: string | null;
  admission_fee: number | null;
  monthly_fee: number | null;
  training_fee: number | null;
  // Status
  status: MemberStatus;
  frozen_until: string | null;
  freeze_reason: string | null;
  // Biometric
  thumb_registered: boolean;
  barcode: string | null;
  device_user_id: string | null;
  // Meta
  comment: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MemberWithJoins extends Member {
  package?: Package | null;
  trainer?: StaffMember | null;
}

export interface FeePayment {
  id: string;
  member_id: string;
  amount: number;
  payment_type: "membership" | "trainer" | "admission" | "other" | null;
  payment_method: PaymentMethod | null;
  payment_date: string;
  month_covered: string | null;
  receipt_no: string | null;
  collected_by: string | null;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface Attendance {
  id: string;
  member_id: string | null;
  staff_id: string | null;
  device_id: string | null;
  punch_time: string;
  punch_type: PunchType | null;
  verified: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  metadata: Json;
  created_at: string;
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  expense_head: string | null;
  payment_method: string | null;
  expense_date: string;
  added_by: string | null;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface DailyMember {
  id: string;
  full_name: string;
  phone: string | null;
  gender: string | null;
  age: number | null;
  fee_paid: number | null;
  payment_method: string | null;
  purpose: string | null;
  notes: string | null;
  visit_date: string;
  added_by: string | null;
  converted_to_member_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface DeviceCommand {
  id: string;
  device_serial: string;
  command_id: number;
  command: string;
  command_type: string;
  status: "pending" | "sent" | "acked" | "failed";
  member_id: string | null;
  created_by: string | null;
  sent_at: string | null;
  acked_at: string | null;
  return_code: number | null;
  error: string | null;
  created_at: string;
}

export interface SmsLog {
  id: string;
  recipients: string[] | null;
  message: string;
  type: string | null;
  sent_by: string | null;
  status: SmsStatus;
  sent_at: string | null;
  created_at: string;
}

// Supabase Database type for typed client
export interface Database {
  public: {
    Tables: {
      packages: { Row: Package; Insert: Omit<Package, "id" | "created_at" | "updated_at">; Update: Partial<Package> };
      staff_members: { Row: StaffMember; Insert: Omit<StaffMember, "id" | "created_at" | "updated_at">; Update: Partial<StaffMember> };
      system_users: { Row: SystemUser; Insert: Omit<SystemUser, "id" | "created_at" | "updated_at">; Update: Partial<SystemUser> };
      submissions: { Row: Submission; Insert: Omit<Submission, "id" | "created_at" | "updated_at">; Update: Partial<Submission> };
      members: { Row: Member; Insert: Omit<Member, "id" | "created_at" | "updated_at">; Update: Partial<Member> };
      fee_payments: { Row: FeePayment; Insert: Omit<FeePayment, "id" | "created_at">; Update: Partial<FeePayment> };
      attendances: { Row: Attendance; Insert: Omit<Attendance, "id" | "created_at">; Update: Partial<Attendance> };
      activity_logs: { Row: ActivityLog; Insert: Omit<ActivityLog, "id" | "created_at">; Update: Partial<ActivityLog> };
      expenses: { Row: Expense; Insert: Omit<Expense, "id" | "created_at">; Update: Partial<Expense> };
      daily_members: { Row: DailyMember; Insert: Omit<DailyMember, "id" | "created_at">; Update: Partial<DailyMember> };
      sms_log: { Row: SmsLog; Insert: Omit<SmsLog, "id" | "created_at">; Update: Partial<SmsLog> };
    };
  };
}
