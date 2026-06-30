-- =============================================================================
-- Fix membership numbers for CSV-imported GymAutomate members
-- The original import used a sequential counter (LUF-2021-0001, 0002…)
-- instead of the old membership card numbers stored in the comment field.
-- This migration rebuilds membership_no from "Old Mbr No: XXX" in each comment.
--
-- Only affects CSV-imported rows (comment LIKE 'GymAutomate ID:%')
-- Excel-imported rows (comment LIKE 'GymAutomate No:%') are excluded.
-- Members without an "Old Mbr No:" entry keep their existing number.
-- =============================================================================

-- STEP 1: Dry run — preview what will change (run this first to verify)
-- SELECT
--   membership_no AS old_no,
--   CONCAT(
--     CASE WHEN gender = 'Female' THEN 'LUF' ELSE 'LUM' END,
--     '-',
--     EXTRACT(YEAR FROM joining_date)::TEXT,
--     '-',
--     LPAD(
--       REGEXP_REPLACE(
--         SUBSTRING(comment FROM 'Old Mbr No: ([0-9]+)'),
--         '[^0-9]', '', 'g'
--       ),
--       4, '0'
--     )
--   ) AS new_no,
--   full_name,
--   comment
-- FROM members
-- WHERE comment LIKE 'GymAutomate ID:%'
--   AND comment LIKE '%Old Mbr No:%'
--   AND REGEXP_REPLACE(
--         SUBSTRING(comment FROM 'Old Mbr No: ([0-9]+)'),
--         '[^0-9]', '', 'g'
--       ) <> ''
--   AND deleted_at IS NULL
-- ORDER BY joining_date, membership_no
-- LIMIT 20;

-- STEP 2: Apply the fix
UPDATE members
SET membership_no = CONCAT(
  CASE WHEN gender = 'Female' THEN 'LUF' ELSE 'LUM' END,
  '-',
  EXTRACT(YEAR FROM joining_date)::TEXT,
  '-',
  LPAD(
    REGEXP_REPLACE(
      SUBSTRING(comment FROM 'Old Mbr No: ([0-9]+)'),
      '[^0-9]', '', 'g'
    ),
    4, '0'
  )
)
WHERE comment LIKE 'GymAutomate ID:%'
  AND comment LIKE '%Old Mbr No:%'
  AND REGEXP_REPLACE(
        SUBSTRING(comment FROM 'Old Mbr No: ([0-9]+)'),
        '[^0-9]', '', 'g'
      ) <> ''
  AND deleted_at IS NULL;

-- STEP 3: Verify after update
-- SELECT membership_no, full_name, comment FROM members WHERE full_name ILIKE 'Sameera Afzal';
-- Expected: LUF-2021-0038

-- Check for duplicate membership numbers (should return 0 rows)
-- SELECT membership_no, COUNT(*) FROM members
-- WHERE deleted_at IS NULL
-- GROUP BY membership_no HAVING COUNT(*) > 1;
