-- Rewrite membership numbers with gender-based prefix
-- LUM = Level Up Male, LUF = Level Up Female
-- Step 1: clear to temp values to avoid unique constraint conflicts mid-update
UPDATE members SET membership_no = 'TMP-' || id::TEXT WHERE deleted_at IS NULL;

-- Step 2: assign correct prefixed numbers ordered by join date within each gender
WITH ranked AS (
  SELECT
    id,
    CASE WHEN gender = 'Female' THEN 'LUF' ELSE 'LUM' END AS prefix,
    EXTRACT(YEAR FROM created_at)::INT                    AS join_year,
    ROW_NUMBER() OVER (
      PARTITION BY CASE WHEN gender = 'Female' THEN 'LUF' ELSE 'LUM' END
      ORDER BY created_at, membership_no
    ) AS rn
  FROM members
  WHERE deleted_at IS NULL
)
UPDATE members
SET
  membership_no = ranked.prefix || '-' || ranked.join_year || '-' || LPAD(ranked.rn::TEXT, 4, '0'),
  updated_at    = NOW()
FROM ranked
WHERE members.id = ranked.id;
