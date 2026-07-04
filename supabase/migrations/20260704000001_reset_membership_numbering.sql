-- =============================================================================
-- Reset membership numbering to a single shared Male/Female sequence
--
-- Client request: LUM/LUF only label gender and YYYY only labels year — the
-- numeric part should be ONE shared, incrementing counter regardless of
-- gender (first registration -> 0001, next registration regardless of
-- gender -> 0002, etc), reset to start fresh at 0001.
--
-- Two problems had to be solved to make a real reset possible:
--   1. The live generator (generateMembershipNo in src/lib/utils.ts) computed
--      MAX(existing number) + 1 per gender prefix — that can never produce 1
--      again once higher numbers exist. Fixed in code: it now computes MAX
--      across BOTH LUM-year and LUF-year rows combined, so the two genders
--      share one counter. That alone still can't reach down to 1 while
--      higher numbers already exist among active/archived rows, which is
--      what steps 1 and 2 below clear out.
--   2. membership_no has a plain, table-wide UNIQUE constraint that still
--      applies to archived (soft-deleted) rows, so old numbers can't just be
--      silently reused — LUF-2026-0001 alone is already taken by a currently
--      active member, and ~24 more LUF-2026-#### numbers are taken by
--      archived rows. Relabeling archived numbers frees the whole range
--      permanently, with no data loss (still fully intact/identifiable).
-- =============================================================================

-- STEP 1: Free up the LUM/LUF-YYYY-NNNN namespace by relabeling archived
-- (soft-deleted) legacy members. Idempotent — skips rows already relabeled.
UPDATE members
SET membership_no = 'OLD-' || membership_no
WHERE deleted_at IS NOT NULL
  AND membership_no NOT LIKE 'OLD-%';

-- STEP 2: Renumber the currently-active roster into the fresh shared
-- sequence, in real registration order (created_at), partitioned by year in
-- case joining years differ. Each member keeps their own gender prefix.
WITH ordered AS (
  SELECT
    id,
    gender,
    COALESCE(EXTRACT(YEAR FROM joining_date), EXTRACT(YEAR FROM created_at))::INT AS yr,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(EXTRACT(YEAR FROM joining_date), EXTRACT(YEAR FROM created_at))::INT
      ORDER BY created_at
    ) AS rn
  FROM members
  WHERE deleted_at IS NULL
)
UPDATE members m
SET membership_no = CONCAT(
      CASE WHEN m.gender = 'Female' THEN 'LUF' ELSE 'LUM' END,
      '-', o.yr, '-', LPAD(o.rn::TEXT, 4, '0')
    ),
    updated_at = NOW()
FROM ordered o
WHERE m.id = o.id;

-- Verify after running:
-- SELECT membership_no, gender, created_at FROM members WHERE deleted_at IS NULL ORDER BY created_at;
-- SELECT count(*) FROM members WHERE membership_no LIKE 'OLD-%';  -- expect 1146
