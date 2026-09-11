-- Revenue-critical table — applied once `members` (its main FK dependency
-- from an access-pattern standpoint) is proven stable.
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

-- Matches CLAUDE.md's "Collect fees: Owner/Manager/Receptionist" row and
-- fees/page.tsx's own useRoleGuard(["owner","manager","receptionist"]).
-- No trainer/viewer access, even though both were previously reachable via
-- the ungated members/[id] profile page — that gap is intentionally closed
-- here, not preserved.
CREATE POLICY "front-desk manage fee_payments"
  ON public.fee_payments FOR ALL
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));
