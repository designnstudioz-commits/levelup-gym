-- Enhance daily_members table with additional tracking fields
ALTER TABLE daily_members ADD COLUMN IF NOT EXISTS purpose TEXT DEFAULT 'Day Pass';
ALTER TABLE daily_members ADD COLUMN IF NOT EXISTS notes   TEXT;
ALTER TABLE daily_members ADD COLUMN IF NOT EXISTS age     INT;
