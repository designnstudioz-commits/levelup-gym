-- Matches CLAUDE.md's "View reports: Owner/Manager" row and
-- reports/page.tsx's own useRoleGuard(["owner","manager"]). No write policy
-- shipped — confirmed zero INSERT/UPDATE/DELETE call sites exist in the app
-- today (no expenses-entry UI exists yet). If rows are ever entered
-- directly via Supabase Studio that remains unaffected — Studio connects
-- as `postgres`, which is not subject to RLS.
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manager view expenses"
  ON public.expenses FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']));
