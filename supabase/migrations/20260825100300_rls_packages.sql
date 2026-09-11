-- Public-facing (the /register form shows active packages to anonymous
-- visitors), low complexity, no PII — safe to do right after submissions.
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read active packages"
  ON public.packages FOR SELECT
  TO anon
  USING (status = 'active');

CREATE POLICY "authenticated read all packages"
  ON public.packages FOR SELECT
  TO authenticated
  USING (true);

-- Matches CLAUDE.md's "Edit packages: Owner/Manager only" row and
-- packages/page.tsx's own useRoleGuard(["owner","manager"]).
CREATE POLICY "owner manager manage packages"
  ON public.packages FOR ALL
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']))
  WITH CHECK (current_role_in(ARRAY['owner','manager']));
