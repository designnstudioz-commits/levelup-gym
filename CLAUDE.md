# Level Up Fitness Club — Gym Management Software

> This file is the single source of truth for this project.
> Claude Code reads this automatically every session. Never delete it.
> Keep it updated as decisions are made.

---

## Project overview

Building a custom gym management web app for **Level Up Fitness Club**, Paragon City, Lahore, Pakistan.

**Client:** Khalid Saeed (CEO) — ceo_1085@levelupfitness.com.pk
**Designer/PM:** Faisal Munir (DesignnStudio)
**Current system being replaced:** GymAutomate v8.3.5
**Database:** Supabase (PostgreSQL)
**Status:** Phase 1 in active development

---

## Brand guidelines

```
Primary orange:   #F06418
Orange dark:      #C04E10
Orange light bg:  #FEF0E8
Orange mid:       #FDDCC8
Dark/black:       #111111
Dark sidebar:     #1A1A1A
White:            #FFFFFF
Border:           #E4E4DE
Text primary:     #1A1A16
Text secondary:   #4A4A44
Text muted:       #7A7A72
```

**Typography:** Barlow + Barlow Condensed (Google Fonts)
- Display/headings: Barlow Condensed 800
- Body: Barlow 400/500/600

**Design language:**
- White background, dark sidebar (#1A1A1A)
- Orange (#F06418) for all primary actions, active states, accents
- Clean, flat — no gradients, no shadows except subtle card borders
- Professional gym software feel — not playful, not corporate

---

## Tech stack decisions (final)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Web framework | Next.js (React) | Pages router, TypeScript |
| Database | Supabase | PostgreSQL + realtime + auth |
| Styling | Tailwind CSS | Utility classes, no CSS modules |
| Form handling | React Hook Form | All forms |
| Validation | Zod | Client + server validation |
| Mobile app | Flutter | Phase 4 — not yet started |
| SMS | Telenor CCSMS | Rs 2/SMS, Pakistani numbers |
| WhatsApp | WATI + Meta API | $49/month platform |
| Email | SendGrid | Free tier sufficient |
| Push notifications | Firebase FCM | Free, unlimited |
| Payments | JazzCash + EasyPaisa | 1.5–2.5% per transaction |
| AI features | Claude API (Anthropic) | Haiku for chatbot, Sonnet for reports |
| Dev tools | Claude Code + Cursor | AI-assisted development |

---

## Project folder structure

```
levelup-gym/
├── CLAUDE.md                  ← this file — never delete
├── docs/                      ← all research and decisions
│   ├── feature-analysis.md    ← full feature list with status
│   ├── database-schema.md     ← all Supabase table definitions
│   ├── brand-guidelines.md    ← colors, fonts, logo rules
│   └── api-contracts.md       ← all API endpoint definitions
├── public/
│   └── logo.png               ← Level Up Fitness logo
├── src/
│   ├── app/                   ← Next.js app router
│   ├── components/            ← shared UI components
│   ├── lib/
│   │   └── supabase.ts        ← Supabase client
│   └── types/
│       └── database.ts        ← TypeScript types for all tables
├── levelup-registration-form.html  ← Phase 1 form (completed design)
└── package.json
```

---

## Supabase database schema

### CRITICAL RULES — never break these:
1. **Never hard delete** — every table has `deleted_at TIMESTAMPTZ` column. Set it, never DROP rows.
2. **Never drop columns** — only ADD new columns. Old columns stay forever.
3. **Never rename columns** — add a new column with the new name, migrate data, mark old as deprecated.
4. **Always use migrations** — every schema change goes in `/supabase/migrations/` with a timestamp prefix.
5. **Status as enum** — never delete enum values, only add new ones.

### Core tables

```sql
-- Member submissions (pending approval queue)
CREATE TABLE submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Personal
  full_name       TEXT NOT NULL,
  secondary_name  TEXT,
  dob             DATE,
  age             INT,
  gender          TEXT CHECK (gender IN ('Male', 'Female')),
  marital_status  TEXT CHECK (marital_status IN ('Single', 'Married')),
  -- Contact
  phone           TEXT NOT NULL,
  whatsapp        TEXT,
  email           TEXT,
  cnic            TEXT,
  address         TEXT,
  -- Referral
  referral_source TEXT,
  referred_by     TEXT,
  -- Physical
  height          TEXT,
  weight          TEXT,
  blood_group     TEXT,
  vaccinated      TEXT,
  injuries        TEXT,
  medical_notes   TEXT,
  -- Emergency
  emergency_name  TEXT,
  emergency_relation TEXT,
  emergency_phone TEXT,
  -- Services
  services_interested TEXT[],   -- array e.g. ['Gym', 'Cardio', 'MMA']
  notes           TEXT,
  photo_url       TEXT,
  -- Official (staff fills)
  package_id      UUID REFERENCES packages(id),
  trainer_id      UUID REFERENCES staff_members(id),
  joining_date    DATE,
  expiry_date     DATE,
  admission_fee   NUMERIC(10,2),
  monthly_fee     NUMERIC(10,2),
  payment_method  TEXT CHECK (payment_method IN ('Cash', 'Bank', 'Card', 'EasyPaisa', 'JazzCash')),
  handled_by      UUID REFERENCES system_users(id),
  -- Workflow
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  submitted_by    UUID REFERENCES system_users(id),
  reviewed_by     UUID REFERENCES system_users(id),
  reviewed_at     TIMESTAMPTZ,
  -- Standard
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Members (approved only — promoted from submissions)
CREATE TABLE members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID REFERENCES submissions(id),  -- original application
  membership_no   TEXT UNIQUE NOT NULL,  -- e.g. LUF-2026-0042
  ref_id          TEXT,                  -- external/card reference number
  -- All personal fields (copied from submission on approval)
  full_name       TEXT NOT NULL,
  secondary_name  TEXT,
  dob             DATE,
  age             INT,
  gender          TEXT,
  marital_status  TEXT,
  phone           TEXT NOT NULL,
  whatsapp        TEXT,
  email           TEXT,
  cnic            TEXT,
  address         TEXT,
  blood_group     TEXT,
  vaccinated      TEXT,
  height          TEXT,
  weight          TEXT,
  medical_notes   TEXT,
  emergency_name  TEXT,
  emergency_phone TEXT,
  photo_url       TEXT,
  -- Membership
  package_id      UUID REFERENCES packages(id),
  trainer_id      UUID REFERENCES staff_members(id),
  nutritionist_id UUID REFERENCES staff_members(id),
  joining_date    DATE,
  expiry_date     DATE,
  admission_fee   NUMERIC(10,2),
  monthly_fee     NUMERIC(10,2),
  training_fee    NUMERIC(10,2),
  -- Status
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'frozen')),
  frozen_until    DATE,
  freeze_reason   TEXT,
  -- Biometric
  thumb_registered BOOLEAN DEFAULT FALSE,
  barcode         TEXT UNIQUE,
  -- Meta
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Packages
CREATE TABLE packages (
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

-- Staff members
CREATE TABLE staff_members (
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

-- System users (login accounts — separate from staff profiles)
CREATE TABLE system_users (
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

-- Fee payments
CREATE TABLE fee_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES members(id) NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  payment_type    TEXT CHECK (payment_type IN ('membership', 'trainer', 'admission', 'other')),
  payment_method  TEXT CHECK (payment_method IN ('Cash', 'Bank', 'Card', 'EasyPaisa', 'JazzCash')),
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  month_covered   DATE,          -- which month this payment covers
  collected_by    UUID REFERENCES system_users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Attendance (from ZKTeco device)
CREATE TABLE attendances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES members(id),
  staff_id        UUID REFERENCES staff_members(id),
  device_id       TEXT,          -- which ZKTeco machine
  punch_time      TIMESTAMPTZ NOT NULL,
  punch_type      TEXT CHECK (punch_type IN ('in', 'out', 'unknown')),
  verified        BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
  -- Note: no deleted_at — attendance records are immutable
);

-- Unverified scans (ZKTeco punch didn't match a member)
CREATE TABLE unverified_attendances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT,
  raw_id          TEXT,          -- finger ID from device
  punch_time      TIMESTAMPTZ NOT NULL,
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_by     UUID REFERENCES system_users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- General activity logs
CREATE TABLE activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES system_users(id),
  action          TEXT NOT NULL,         -- e.g. 'paid_fee', 'added_member', 'approved_submission'
  entity_type     TEXT NOT NULL,         -- e.g. 'member', 'submission', 'package'
  entity_id       UUID,
  description     TEXT NOT NULL,         -- human-readable e.g. "Fizza Salman paid fee Rs10,000 of Arsal Imran"
  metadata        JSONB DEFAULT '{}',    -- any extra structured data
  created_at      TIMESTAMPTZ DEFAULT NOW()
  -- No deleted_at — logs are immutable
);

-- Expenses
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  expense_head    TEXT,          -- category e.g. 'Rent', 'Salaries', 'Utilities'
  payment_method  TEXT,
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  added_by        UUID REFERENCES system_users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Daily members (walk-ins — separate lightweight table)
CREATE TABLE daily_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  phone           TEXT,
  gender          TEXT,
  fee_paid        NUMERIC(10,2),
  payment_method  TEXT,
  visit_date      DATE DEFAULT CURRENT_DATE,
  added_by        UUID REFERENCES system_users(id),
  converted_to_member_id UUID REFERENCES members(id),  -- if converted
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- SMS log
CREATE TABLE sms_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipients      TEXT[],        -- phone numbers
  message         TEXT NOT NULL,
  type            TEXT,          -- 'fee_reminder', 'announcement', 'welcome', etc.
  sent_by         UUID REFERENCES system_users(id),
  status          TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Permissions matrix (RBAC)

| Permission | Owner | Manager | Receptionist | Trainer | Viewer |
|-----------|-------|---------|-------------|---------|--------|
| View dashboard | ✓ | ✓ | ✓ | ✗ | ✓ |
| Add members | ✓ | ✓ | ✓ | ✗ | ✗ |
| Approve submissions | ✓ | ✓ | ✗ | ✗ | ✗ |
| Collect fees | ✓ | ✓ | ✓ | ✗ | ✗ |
| View reports | ✓ | ✓ | ✗ | ✗ | ✗ |
| Edit packages | ✓ | ✓ | ✗ | ✗ | ✗ |
| Send SMS | ✓ | ✓ | ✓ | ✗ | ✗ |
| View attendance | ✓ | ✓ | ✓ | ✓ | ✗ |
| Manage users | ✓ | ✗ | ✗ | ✗ | ✗ |
| System settings | ✓ | ✗ | ✗ | ✗ | ✗ |
| Delete/archive members | ✓ | ✓ | ✗ | ✗ | ✗ |

---

## Build phases

### Phase 1 — CURRENT (Weeks 1–3)
- [x] Member registration form (HTML design complete — `levelup-registration-form.html`)
- [ ] Next.js project setup
- [ ] Supabase project + schema setup
- [ ] Form connected to Supabase `submissions` table
- [ ] Dashboard submissions view (approve/reject queue)
- [ ] Basic member list view

### Phase 2 — Core enhancements (Weeks 4–8)
- [ ] QR code on printed form → member fills on phone
- [ ] SMS API (Telenor CCSMS)
- [ ] Automated fee reminders
- [ ] WhatsApp integration (WATI)
- [ ] Staff payroll module
- [ ] Payment receipts (PDF)
- [ ] Discounts & custom pricing

### Phase 3 — POS & inventory (Weeks 9–13)
- [ ] Full POS system
- [ ] Inventory management
- [ ] Product barcode scanning

### Phase 4 — Mobile app (Weeks 14–22)
- [ ] Flutter app (iOS + Android)
- [ ] Member profile + digital card
- [ ] Fee payment in app
- [ ] Class booking
- [ ] Push notifications

### Phase 5 — Website + multi-branch (Weeks 23–28)
- [ ] Public website
- [ ] Online membership inquiry
- [ ] Multi-branch support

### Phase 6 — AI & automation (Weeks 29–32)
- [ ] Churn prediction
- [ ] AI chatbot (WhatsApp + app)
- [ ] Smart fee reminders
- [ ] Weekly AI insights report

---

## Existing gym data (Level Up Fitness)

- **41 registered members** (40 male, 1 female)
- **21 pending fees** as of May 2026
- **Revenue:** Rs 2,32,020 (May 2026)
- **7 packages:** Gym (Rs 7,500), Gym with Cardio (Rs 8,500), Hybrid Workout (Rs 10,000), MMA (Rs 7,500), CrossFit (Rs 7,500), Table Tennis (Rs 3,500), Premium (Rs 15,000)
- **Admission fee:** Rs 15,000 (flat across all packages)
- **Location:** 3rd floor, High Street Mall, Paragon City, Lahore
- **Contact:** 03000202902

---

## Key conventions & coding rules

1. **All monetary values** stored as `NUMERIC(10,2)` in PKR (Pakistani Rupee)
2. **All timestamps** in UTC, display in PKT (Pakistan Standard Time, UTC+5)
3. **Soft deletes only** — check `WHERE deleted_at IS NULL` on every query
4. **Membership number format:** `LUF-YYYY-NNNN` (e.g. LUF-2026-0042)
5. **Phone numbers** stored as-is (e.g. 0300-1234567) — no normalization
6. **CNIC format:** XXXXX-XXXXXXX-X (validated on input, stored as-is)
7. **Photo storage:** Supabase Storage bucket `member-photos`, URL stored in table
8. **All forms** use React Hook Form + Zod validation
9. **No hard deletes anywhere** — ever
10. **Every user action** must create a row in `activity_logs`

---

## Files already built

| File | Status | Notes |
|------|--------|-------|
| `levelup-registration-form.html` | ✅ Complete | 4-step form, branded, all fields, validation |
| `CLAUDE.md` | ✅ This file | Keep updated |

---

## What to build next (immediate priority)

1. Run `npx create-next-app@latest levelup-gym --typescript --tailwind --app` to scaffold the project
2. Set up Supabase — create project at supabase.com, run the SQL schema above
3. Add `src/lib/supabase.ts` with the Supabase client
4. Convert `levelup-registration-form.html` into a Next.js page at `/register`
5. Build the dashboard at `/dashboard` with the submissions inbox

---

## Reference documents (in `/docs` folder)

- `feature-analysis.docx` — Full 43-feature analysis with EXISTS/PARTIAL/MISSING status
- `timeline-pricing.docx` — 6-phase timeline + AI model pricing + SMS costs
- `unit-economics.docx` — Per-user cost analysis, scale table, SaaS pricing
- `membership-form.docx` — Original paper membership form fields

---

*Last updated: June 2026 — Faisal Munir (DesignnStudio)*
