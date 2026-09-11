-- Follow-up to 20260913100000: Supabase's default-privilege behavior grants
-- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER to anon AND authenticated
-- on any newly created relation (same class of issue Phase H found on the
-- pos_* tables) — including staff_directory_public getting an unintended
-- anon SELECT grant, silently defeating the "authenticated only" intent of
-- that view. Caught by re-querying information_schema.role_table_grants
-- immediately after applying the previous migration, not assumed correct.

REVOKE ALL ON public.staff_trainers_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_trainers_public TO anon, authenticated;

REVOKE ALL ON public.staff_directory_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_directory_public TO authenticated;
