-- Business rule correction (2026-09-13): there is no owner/manager
-- approval workflow for PT trainer commission — reception handles it
-- operationally as part of normal registration and fee collection. The
-- original migration (20260825101500_rls_trainer_member_commissions.sql)
-- restricted INSERT/UPDATE to owner/manager only, matching what was
-- believed to be the intended rule at the time. It wasn't: the UI never
-- enforced that restriction (Step3Services.tsx and the member profile's
-- PT pricing editor have always let any role reach these fields), so RLS
-- was the only enforcement point — and it silently broke every
-- receptionist-initiated PT registration once this policy went live
-- (2026-09-11), which is the confirmed root cause of the Mansoor incident
-- (see the forensic investigation earlier this session: reproduced live,
-- exact error 42501 on this exact policy).
--
-- This does not introduce any approval workflow — it removes the
-- mismatch between what the UI already allowed and what the database
-- allowed. Scope is deliberately narrow: only this rate-setting table.
-- trainer_commission_ledger (the payout/processing table) is untouched —
-- "owner manager process commission payouts" (UPDATE) stays owner/manager
-- only, and receptionist's existing ledger access there was already
-- scoped to generating/reading entries, never approving payouts.

DROP POLICY IF EXISTS "owner manager set commission rates" ON public.trainer_member_commissions;
DROP POLICY IF EXISTS "owner manager update commission rates" ON public.trainer_member_commissions;

CREATE POLICY "front-desk set commission rates"
  ON public.trainer_member_commissions FOR INSERT
  TO authenticated
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "front-desk update commission rates"
  ON public.trainer_member_commissions FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));
