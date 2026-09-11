-- Historical commission payout ledger. Same receptionist-INSERT
-- requirement as trainer_member_commissions (previous migration) —
-- src/lib/commission.ts auto-generates a ledger row here during ordinary
-- receptionist-collected fee payments, so INSERT cannot be owner/manager
-- only. Marking a payout as paid, however, stays admin-only, matching
-- dashboard/commissions/page.tsx's own useRoleGuard(["owner","manager"]).
ALTER TABLE public.trainer_commission_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk read commission ledger"
  ON public.trainer_commission_ledger FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "trainer read own commission ledger"
  ON public.trainer_commission_ledger FOR SELECT
  TO authenticated
  USING (trainer_id = current_staff_id());

CREATE POLICY "front-desk generate commission ledger rows"
  ON public.trainer_commission_ledger FOR INSERT
  TO authenticated
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "owner manager process commission payouts"
  ON public.trainer_commission_ledger FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']))
  WITH CHECK (current_role_in(ARRAY['owner','manager']));
