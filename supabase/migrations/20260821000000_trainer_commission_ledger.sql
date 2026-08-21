-- Historical trainer-commission earnings ledger. trainer_member_commissions
-- stays the CURRENT commission rule per (trainer, member); this table is
-- the separate historical record of what was actually earned each cycle —
-- one row per member per half-month commission cycle, with the PT Fee and
-- commission rate FROZEN at the moment the row was generated, so a later
-- change to trainer_member_commissions never rewrites a past earning.
--
-- Generated from qualifying fee_payments rows (payment_type IN
-- ('membership','trainer'), for a member with training_fee + trainer_id +
-- an active trainer_member_commissions rate) using each payment's
-- coverage_start as the qualifying date — NOT payment_date — so backdating
-- when a payment was collected can never move a trainer into a different
-- payout cycle. See src/lib/commission.ts for the generation logic and the
-- 15-day cycle rule.
CREATE TABLE trainer_commission_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         UUID REFERENCES members(id) NOT NULL,
  trainer_id        UUID REFERENCES staff_members(id) NOT NULL,
  fee_payment_id    UUID REFERENCES fee_payments(id),

  -- Frozen at generation time — never recalculated when the trainer's
  -- current rate (trainer_member_commissions) changes later.
  pt_fee              NUMERIC(10,2) NOT NULL,
  commission_type     TEXT NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'fixed')),
  commission_percent  NUMERIC(5,2),
  commission_amount   NUMERIC(10,2) NOT NULL,

  qualifying_date   DATE NOT NULL,
  cycle_start       DATE NOT NULL,
  cycle_end         DATE NOT NULL,
  payout_date       DATE NOT NULL,

  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_date         DATE,
  paid_amount       NUMERIC(10,2),
  payout_reference  TEXT,
  processed_by      UUID REFERENCES system_users(id),

  created_by        UUID REFERENCES system_users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- One earning per member per cycle — the idempotency guarantee. A split
-- Cash+Bank payment shares one coverage_start (same cycle), so whichever
-- row is processed first creates the entry and the rest no-op.
CREATE UNIQUE INDEX trainer_commission_ledger_unique_cycle
  ON trainer_commission_ledger (member_id, cycle_start)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_trainer_commission_ledger_trainer
  ON trainer_commission_ledger (trainer_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_trainer_commission_ledger_status
  ON trainer_commission_ledger (status)
  WHERE deleted_at IS NULL;
