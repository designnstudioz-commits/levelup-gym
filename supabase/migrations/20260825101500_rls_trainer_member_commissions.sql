-- Per-trainer-per-member commission rate config. Receptionist SELECT is
-- REQUIRED, not optional — src/lib/commission.ts (called from
-- dashboard/fees/page.tsx, which receptionist can reach) reads this table
-- on every PT-eligible fee collection. Restricting SELECT to owner/manager
-- only would silently break commission-ledger generation for every
-- receptionist-collected PT payment starting the moment this migration lands.
ALTER TABLE public.trainer_member_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk read commission rates"
  ON public.trainer_member_commissions FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "trainer read own commission rates"
  ON public.trainer_member_commissions FOR SELECT
  TO authenticated
  USING (trainer_id = current_staff_id());

-- Setting the rate itself stays owner/manager only — matches CLAUDE.md's
-- "Set trainer commission" row and staff/[id]/page.tsx's own gating.
CREATE POLICY "owner manager set commission rates"
  ON public.trainer_member_commissions FOR INSERT
  TO authenticated
  WITH CHECK (current_role_in(ARRAY['owner','manager']));

CREATE POLICY "owner manager update commission rates"
  ON public.trainer_member_commissions FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']))
  WITH CHECK (current_role_in(ARRAY['owner','manager']));
