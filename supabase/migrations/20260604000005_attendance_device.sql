-- Link members to ZKTeco device enrollment
ALTER TABLE members       ADD COLUMN IF NOT EXISTS device_user_id TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS device_user_id TEXT;

-- Fast lookup during real-time punch sync
CREATE INDEX IF NOT EXISTS idx_members_device_user_id
  ON members(device_user_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_device_user_id
  ON staff_members(device_user_id) WHERE deleted_at IS NULL;

-- Store known device serials
CREATE TABLE IF NOT EXISTS devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_no   TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Main Entrance',
  location    TEXT,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
