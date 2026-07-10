-- =============================================================================
-- Prevent duplicate device_commands rows for the same device.
--
-- command_id is currently generated client-side as count(existing)+1 with no
-- database-level guarantee — two concurrent pushes to the same device could
-- silently write duplicate (device_serial, command_id) pairs, corrupting
-- command/ack tracking (getrequest and devicecmd both filter/update by this
-- pair). This constraint turns a silent collision into a loud insert error
-- so the API can catch it and retry, instead of corrupting state quietly.
--
-- Verified no existing duplicates before adding this constraint.
-- =============================================================================

ALTER TABLE device_commands
  ADD CONSTRAINT device_commands_serial_command_id_unique UNIQUE (device_serial, command_id);
