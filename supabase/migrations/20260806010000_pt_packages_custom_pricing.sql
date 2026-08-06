-- Personal Training packages no longer have a fixed catalog price — staff
-- enter a custom, negotiated price per member at registration (or later via
-- the member's own profile). monthly_fee must become nullable to support
-- this; existing PT packages' catalog prices are cleared so the Packages
-- page correctly shows them as "Custom pricing" going forward.
ALTER TABLE packages ALTER COLUMN monthly_fee DROP NOT NULL;
UPDATE packages SET monthly_fee = NULL WHERE name LIKE 'Personal Training%';
