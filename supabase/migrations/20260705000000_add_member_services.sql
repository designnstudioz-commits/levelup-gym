-- =============================================================================
-- Link membership packages to a member's Services & Activities
--
-- Previously, the "Services & Activities" section on a member's profile had
-- no real home on the `members` table at all — it loaded/saved through
-- member.submission_id -> submissions.services_interested, a snapshot of the
-- ORIGINAL registration application, not the member's current live state.
-- That left every member with no linked submission (all CSV-imported /
-- GymAutomate members, and possibly others) permanently stuck with an empty,
-- unsavable Services & Activities section.
--
-- This gives `members` its own real, persistent `services` column, and
-- backfills it sensibly so nobody's current services appear to vanish:
--   - If a member has a submission with non-empty services_interested,
--     copy that in.
--   - Otherwise, default to their current package's services_included
--     (packages.services_included, TEXT[], added in
--     20260604000003_packages_enhanced.sql) if they have a package_id —
--     a much better starting point than empty, and consistent with the new
--     "package defines default services" behavior going forward.
-- =============================================================================

-- STEP 1: Add the column
ALTER TABLE members ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';

-- STEP 2: Backfill from linked submission's services_interested, where present
UPDATE members m
SET services = s.services_interested
FROM submissions s
WHERE m.submission_id = s.id
  AND s.services_interested IS NOT NULL
  AND array_length(s.services_interested, 1) > 0
  AND (m.services IS NULL OR array_length(m.services, 1) IS NULL);

-- STEP 3: For everyone still empty, default to their package's services_included
UPDATE members m
SET services = p.services_included
FROM packages p
WHERE m.package_id = p.id
  AND p.services_included IS NOT NULL
  AND array_length(p.services_included, 1) > 0
  AND (m.services IS NULL OR array_length(m.services, 1) IS NULL);

-- Verify after running:
-- SELECT full_name, membership_no, services FROM members WHERE deleted_at IS NULL ORDER BY created_at LIMIT 20;
-- SELECT count(*) FROM members WHERE deleted_at IS NULL AND (services IS NULL OR array_length(services,1) IS NULL); -- remaining empty (no submission + no package)
