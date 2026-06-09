-- Support multiple packages per member/submission
ALTER TABLE members     ADD COLUMN IF NOT EXISTS package_ids UUID[];
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS package_ids UUID[];
