-- Replaces the package-tier-driven PT commission rate table (pt_commission_rates)
-- with a fully manual model: the owner/manager sets a commission percentage
-- per (trainer, member) pair directly on the trainer's own Staff page,
-- independent of which package the member is on. The package a member picks
-- at registration (Gold/Silver/Bronze/Platinum) remains purely informational/
-- historical — it no longer drives any commission calculation.
--
-- Commission for a given period is computed as:
--   (member's collected fee_payments amount for that period − flat gym cut) * commission_percent
-- with the flat gym cut currently a hardcoded constant in the app (see
-- src/app/dashboard/staff/[id]/page.tsx), not stored per-row here, since
-- every row of the old pt_commission_rates chart used the same Rs 10,000
-- gym cut regardless of tier.
CREATE TABLE trainer_member_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id          UUID REFERENCES staff_members(id) NOT NULL,
  member_id           UUID REFERENCES members(id) NOT NULL,
  commission_percent  NUMERIC(5,2) NOT NULL,
  updated_by          UUID REFERENCES system_users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- One active rate per (trainer, member) pair — a partial index so a
-- soft-deleted row doesn't block re-creating a fresh one for the same pair.
CREATE UNIQUE INDEX trainer_member_commissions_unique_pair
  ON trainer_member_commissions (trainer_id, member_id)
  WHERE deleted_at IS NULL;
