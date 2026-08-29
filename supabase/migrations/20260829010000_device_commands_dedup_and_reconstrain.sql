-- Prevent duplicate device_commands rows for the same device (concurrent
-- command_id races). This exact constraint was supposed to already exist
-- (see 20260707000000_device_commands_unique_constraint.sql) but was
-- apparently never actually applied in production — confirmed 2026-08-29
-- via directly observed duplicate (device_serial, command_id) rows, caused
-- by two overlapping access-sweep runs racing on the same
-- count(*)+1-then-insert command_id assignment (the first sweep call's
-- server-side execution kept running past a client-side timeout; a second
-- call issued shortly after ran concurrently against it). Without this
-- constraint, the retry-on-collision logic in every push route
-- (push-user, delete-user, src/lib/server/devicePush.ts) silently does
-- nothing under a real race, since no error is ever raised to trigger it.

-- Dedup existing duplicates first — ADD CONSTRAINT fails if any exist.
-- For each duplicate group, keep whichever row the device actually
-- acknowledged (the one real interaction that matters); if none acked,
-- keep the earliest-created row. All 135 members blocked during the
-- 2026-08-29 rollout were individually re-verified acked by PIN
-- afterward, so this cleanup only removes bookkeeping duplicates, not
-- anything that changes real device state.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY device_serial, command_id
      ORDER BY (status = 'acked') DESC, created_at ASC
    ) AS rn
  FROM device_commands
)
DELETE FROM device_commands WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Idempotent — safe to re-run.
ALTER TABLE device_commands DROP CONSTRAINT IF EXISTS device_commands_serial_command_id_unique;
ALTER TABLE device_commands
  ADD CONSTRAINT device_commands_serial_command_id_unique UNIQUE (device_serial, command_id);

-- Verify after running (should return zero rows):
-- SELECT device_serial, command_id, COUNT(*) FROM device_commands GROUP BY 1,2 HAVING COUNT(*) > 1;
