-- =============================================================================
-- Backfill migration for device_enrollments — this table already exists in
-- the live database (created directly in Supabase Studio, never captured in
-- a tracked migration) but is actively queried by the ZKTeco integration
-- (attendance push handler, push-user API, member bulk-enroll). This
-- documents its real current schema so it's reproducible in a fresh
-- environment and tracked like every other table.
--
-- Uses IF NOT EXISTS throughout, so running this against the current
-- database (where the table already exists) is a safe no-op.
-- =============================================================================

CREATE TABLE IF NOT EXISTS device_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID REFERENCES members(id),
  device_serial   TEXT NOT NULL,
  device_user_id  TEXT NOT NULL,
  enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_enrollments_member_device
  ON device_enrollments(member_id, device_serial);

-- Verify after running:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'device_enrollments';
