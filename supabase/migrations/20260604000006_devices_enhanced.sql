-- Enhance devices table for multi-machine gym setup
ALTER TABLE devices ADD COLUMN IF NOT EXISTS color     TEXT DEFAULT '#F06418';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS door_type TEXT DEFAULT 'Entrance';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- Seed example device entries (will be auto-created on first push too)
-- UPDATE devices SET name = 'Main Entrance', location = 'Ground Floor', color = '#F06418', door_type = 'Entrance' WHERE serial_no = 'YOUR_SERIAL_1';
