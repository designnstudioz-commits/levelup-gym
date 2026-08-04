-- Trainer commission lookup table for Personal Training packages.
-- Each Personal Training tier (Bronze/Silver/Gold/Platinum) can be billed at
-- several different total-fee amounts; the trainer's share of the PT-fee
-- portion (total minus the gym's flat Rs 10,000 cut) varies per amount, not
-- just per tier. This table drives an auto-fill suggestion in the Collect
-- Fee flow — staff can still override the rate/amount manually.
CREATE TABLE pt_commission_rates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id             UUID REFERENCES packages(id) NOT NULL,
  total_fee              NUMERIC(10,2) NOT NULL,
  gym_fee                NUMERIC(10,2) NOT NULL DEFAULT 10000,
  pt_fee                 NUMERIC(10,2) NOT NULL,
  trainer_share_percent  NUMERIC(5,2) NOT NULL,
  trainer_share_amount   NUMERIC(10,2) NOT NULL,
  status                 TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

-- Joined against packages by name (not a hardcoded id) so this seeds a row
-- for every package sharing that tier name — including the inactive
-- duplicate rows currently in this database, so the lookup still works for
-- any member linked to one of those rather than only the active row.
INSERT INTO pt_commission_rates (package_id, total_fee, gym_fee, pt_fee, trainer_share_percent, trainer_share_amount)
SELECT p.id, v.total_fee, v.gym_fee, v.pt_fee, v.trainer_share_percent, v.trainer_share_amount
FROM packages p
JOIN (VALUES
  -- Gold
  ('Personal Training — Gold', 35000, 10000, 25000, 40, 10000),
  ('Personal Training — Gold', 30000, 10000, 20000, 40, 8000),
  ('Personal Training — Gold', 25000, 10000, 15000, 50, 7500),
  ('Personal Training — Gold', 20000, 10000, 10000, 60, 6000),
  -- Bronze
  ('Personal Training — Bronze', 25000, 10000, 15000, 40, 6000),
  ('Personal Training — Bronze', 20000, 10000, 10000, 40, 4000),
  ('Personal Training — Bronze', 15000, 10000, 5000, 50, 2500),
  -- Silver
  ('Personal Training — Silver', 30000, 10000, 20000, 40, 8000),
  ('Personal Training — Silver', 25000, 10000, 15000, 40, 6000),
  ('Personal Training — Silver', 20000, 10000, 10000, 50, 5000),
  ('Personal Training — Silver', 15000, 10000, 5000, 60, 3000),
  -- Platinum
  ('Personal Training — Platinum', 50000, 10000, 40000, 40, 16000),
  ('Personal Training — Platinum', 45000, 10000, 35000, 40, 14000),
  ('Personal Training — Platinum', 40000, 10000, 30000, 50, 15000),
  ('Personal Training — Platinum', 35000, 10000, 25000, 60, 15000),
  ('Personal Training — Platinum', 30000, 10000, 20000, 70, 14000),
  ('Personal Training — Platinum', 25000, 10000, 15000, 100, 15000)
) AS v(name, total_fee, gym_fee, pt_fee, trainer_share_percent, trainer_share_amount)
ON p.name = v.name;
