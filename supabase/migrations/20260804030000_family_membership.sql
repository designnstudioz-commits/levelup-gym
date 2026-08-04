-- Family membership: a receptionist can link a new member to an existing
-- active member as a family registration. Payment is still collected in
-- full at registration (per confirmed flow); the member is created in a
-- new pending state for an Owner/Manager to later decide Free/Discounted/
-- Full pricing. Since the fee was already collected at full price, that
-- later decision is recorded as a pricing note/credit flag rather than
-- reversing the original payment (no ledger/refund system — kept
-- pragmatic per project conventions).

ALTER TABLE members ADD COLUMN IF NOT EXISTS family_primary_member_id UUID REFERENCES members(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_relationship TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_notes TEXT;

-- Admin's post-registration pricing decision (set once, at approval time).
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_pricing_decision TEXT
  CHECK (family_pricing_decision IN ('free', 'discounted', 'full'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_pricing_note TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_approved_by UUID REFERENCES system_users(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS family_approved_at TIMESTAMPTZ;

-- New status value — additive superset, per convention (CHECK constraints
-- aren't incrementally alterable, so drop + recreate with every existing
-- value plus the new one).
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_status_check;
ALTER TABLE members ADD CONSTRAINT members_status_check
  CHECK (status IN ('active', 'inactive', 'archived', 'frozen', 'pending_family_approval'));

-- Speeds up the new /dashboard/family-approvals page's query.
CREATE INDEX IF NOT EXISTS idx_members_pending_family_approval
  ON members(status) WHERE status = 'pending_family_approval' AND deleted_at IS NULL;

-- Verify after running:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'members_status_check';
