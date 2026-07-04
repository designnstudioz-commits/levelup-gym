-- =============================================================================
-- Archive all GymAutomate-imported members
-- Client request: only members registered through this app should count as
-- the active roster. Old data must not be lost, so this is a SOFT delete only
-- (status='archived' + deleted_at set) — never a hard DELETE. Archived rows
-- remain fully intact and are still visible via the "Archived" status filter
-- on the members list; they just drop out of active views/counts/reports.
--
-- Every imported row (both import batches) carries a comment starting with
-- "GymAutomate" — set only by the import migrations below, never by any
-- app code, so this is a reliable, exception-free filter:
--   20260628100000_import_gymAutomate_members.sql   (Excel batch, 100 rows,  comment LIKE 'GymAutomate No:%')
--   20260629000001_import_gymAutomate_csv.sql       (CSV batch,  1046 rows, comment LIKE 'GymAutomate ID:%')
-- Expected total affected: 1146 rows.
-- =============================================================================

-- STEP 1: Dry run — verify the expected row count before applying
-- SELECT count(*) FROM members WHERE comment LIKE 'GymAutomate%' AND deleted_at IS NULL;
-- Expected: 1146

-- STEP 2: Apply the archive
UPDATE members
SET status = 'archived',
    deleted_at = NOW(),
    updated_at = NOW()
WHERE comment LIKE 'GymAutomate%'
  AND deleted_at IS NULL;

-- STEP 3: Verify after update (should return 0)
-- SELECT count(*) FROM members WHERE comment LIKE 'GymAutomate%' AND deleted_at IS NULL;

-- UNDO — if the client ever wants these members restored, run this
-- (scoped to the archive timestamp so it can't accidentally revive members
-- who were separately/legitimately archived before or after this migration).
-- This migration was actually run at: 2026-07-04T09:19:22.886Z (1146 rows).
-- UPDATE members
-- SET status = 'active', deleted_at = NULL
-- WHERE comment LIKE 'GymAutomate%'
--   AND deleted_at = '2026-07-04T09:19:22.886+00:00';
