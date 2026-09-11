-- Legacy table, fully superseded by trainer_member_commissions (see that
-- table's own migration comment, 20260722150000). Confirmed zero app-code
-- references remain — grep across src/ for "pt_commission_rates" returns
-- nothing. Per this project's own CLAUDE.md rule ("never drop columns" —
-- by extension, tables aren't dropped either), it's still live in the
-- database and was still directly queryable via PostgREST with zero auth
-- until now. Closing it read-only for owner/manager as the final table in
-- this rollout, so nothing in the database is left open.
ALTER TABLE public.pt_commission_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manager view legacy pt_commission_rates"
  ON public.pt_commission_rates FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']));

-- No write policy — nothing writes this table anymore.
