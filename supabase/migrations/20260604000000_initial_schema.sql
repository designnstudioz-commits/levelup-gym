-- Level Up Fitness Club — Initial Schema
-- All tables use soft deletes (deleted_at) except attendances and logs (immutable)

-- 1. Packages (no foreign key deps)
CREATE TABLE IF NOT EXISTS packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT CHECK (type IN ('Individual', 'Family', 'Couple', 'Daily')),
  duration_months INT DEFAULT 1,
  admission_fee   NUMERIC(10,2) DEFAULT 15000,
  monthly_fee     NUMERIC(10,2) NOT NULL,
  max_members     INT DEFAULT 1,
  description     TEXT,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 2. Staff members
CREATE TABLE IF NOT EXISTS staff_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  role            TEXT CHECK (role IN ('Trainer', 'Receptionist', 'Manager', 'Nutritionist', 'Other')),
  phone           TEXT,
  email           TEXT,
  cnic            TEXT,
  salary          NUMERIC(10,2),
  joining_date    DATE,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 3. System users (login accounts)
CREATE TABLE IF NOT EXISTS system_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        UUID REFERENCES staff_members(id),
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  role            TEXT CHECK (role IN ('owner', 'manager', 'receptionist', 'trainer', 'viewer')),
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 4. Submissions (pending approval queue)
CREATE TABLE IF NOT EXISTS submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Personal
  full_name           TEXT NOT NULL,
  secondary_name      TEXT,
  dob                 DATE,
  age                 INT,
  gender              TEXT CHECK (gender IN ('Male', 'Female')),
  marital_status      TEXT CHECK (marital_status IN ('Single', 'Married')),
  -- Contact
  phone               TEXT NOT NULL,
  whatsapp            TEXT,
  email               TEXT,
  cnic                TEXT,
  address             TEXT,
  -- Referral
  referral_source     TEXT,
  referred_by         TEXT,
  -- Physical
  height              TEXT,
  weight              TEXT,
  blood_group         TEXT,
  vaccinated          TEXT,
  injuries            TEXT,
  medical_notes       TEXT,
  -- Emergency
  emergency_name      TEXT,
  emergency_relation  TEXT,
  emergency_phone     TEXT,
  -- Services
  services_interested TEXT[],
  notes               TEXT,
  photo_url           TEXT,
  -- Official (staff fills)
  package_id          UUID REFERENCES packages(id),
  trainer_id          UUID REFERENCES staff_members(id),
  joining_date        DATE,
  expiry_date         DATE,
  admission_fee       NUMERIC(10,2),
  monthly_fee         NUMERIC(10,2),
  payment_method      TEXT CHECK (payment_method IN ('Cash', 'Bank', 'Card', 'EasyPaisa', 'JazzCash')),
  handled_by          UUID REFERENCES system_users(id),
  -- Workflow
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason    TEXT,
  submitted_by        UUID REFERENCES system_users(id),
  reviewed_by         UUID REFERENCES system_users(id),
  reviewed_at         TIMESTAMPTZ,
  -- Standard
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- 5. Members (approved only)
CREATE TABLE IF NOT EXISTS members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID REFERENCES submissions(id),
  membership_no       TEXT UNIQUE NOT NULL,
  ref_id              TEXT,
  -- Personal (copied from submission on approval)
  full_name           TEXT NOT NULL,
  secondary_name      TEXT,
  dob                 DATE,
  age                 INT,
  gender              TEXT,
  marital_status      TEXT,
  phone               TEXT NOT NULL,
  whatsapp            TEXT,
  email               TEXT,
  cnic                TEXT,
  address             TEXT,
  blood_group         TEXT,
  vaccinated          TEXT,
  height              TEXT,
  weight              TEXT,
  medical_notes       TEXT,
  emergency_name      TEXT,
  emergency_phone     TEXT,
  photo_url           TEXT,
  -- Membership
  package_id          UUID REFERENCES packages(id),
  trainer_id          UUID REFERENCES staff_members(id),
  nutritionist_id     UUID REFERENCES staff_members(id),
  joining_date        DATE,
  expiry_date         DATE,
  admission_fee       NUMERIC(10,2),
  monthly_fee         NUMERIC(10,2),
  training_fee        NUMERIC(10,2),
  -- Status
  status              TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'frozen')),
  frozen_until        DATE,
  freeze_reason       TEXT,
  -- Biometric
  thumb_registered    BOOLEAN DEFAULT FALSE,
  barcode             TEXT UNIQUE,
  -- Meta
  comment             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- 6. Fee payments
CREATE TABLE IF NOT EXISTS fee_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES members(id) NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  payment_type    TEXT CHECK (payment_type IN ('membership', 'trainer', 'admission', 'other')),
  payment_method  TEXT CHECK (payment_method IN ('Cash', 'Bank', 'Card', 'EasyPaisa', 'JazzCash')),
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  month_covered   DATE,
  collected_by    UUID REFERENCES system_users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 7. Attendance (from ZKTeco device — immutable)
CREATE TABLE IF NOT EXISTS attendances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES members(id),
  staff_id        UUID REFERENCES staff_members(id),
  device_id       TEXT,
  punch_time      TIMESTAMPTZ NOT NULL,
  punch_type      TEXT CHECK (punch_type IN ('in', 'out', 'unknown')),
  verified        BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Unverified scans
CREATE TABLE IF NOT EXISTS unverified_attendances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT,
  raw_id          TEXT,
  punch_time      TIMESTAMPTZ NOT NULL,
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_by     UUID REFERENCES system_users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Activity logs (immutable)
CREATE TABLE IF NOT EXISTS activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES system_users(id),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  description     TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  expense_head    TEXT,
  payment_method  TEXT,
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  added_by        UUID REFERENCES system_users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 11. Daily members (walk-ins)
CREATE TABLE IF NOT EXISTS daily_members (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name               TEXT NOT NULL,
  phone                   TEXT,
  gender                  TEXT,
  fee_paid                NUMERIC(10,2),
  payment_method          TEXT,
  visit_date              DATE DEFAULT CURRENT_DATE,
  added_by                UUID REFERENCES system_users(id),
  converted_to_member_id  UUID REFERENCES members(id),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

-- 12. SMS log
CREATE TABLE IF NOT EXISTS sms_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipients      TEXT[],
  message         TEXT NOT NULL,
  type            TEXT,
  sent_by         UUID REFERENCES system_users(id),
  status          TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_expiry ON members(expiry_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fee_payments_member ON fee_payments(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendances_punch_time ON attendances(punch_time);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at_packages BEFORE UPDATE ON packages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_staff_members BEFORE UPDATE ON staff_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_system_users BEFORE UPDATE ON system_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_submissions BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_members BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed: 7 packages
INSERT INTO packages (name, type, monthly_fee, admission_fee, description) VALUES
  ('Gym', 'Individual', 7500, 15000, 'Full gym access — weights, machines, free area'),
  ('Gym with Cardio', 'Individual', 8500, 15000, 'Gym access + cardio equipment zone'),
  ('Hybrid Workout', 'Individual', 10000, 15000, 'Functional training + gym + cardio combo'),
  ('MMA', 'Individual', 7500, 15000, 'Mixed Martial Arts training program'),
  ('CrossFit', 'Individual', 7500, 15000, 'High-intensity functional training classes'),
  ('Table Tennis', 'Individual', 3500, 15000, 'Table tennis court access'),
  ('Premium', 'Individual', 15000, 15000, 'All-access premium membership')
ON CONFLICT DO NOTHING;
