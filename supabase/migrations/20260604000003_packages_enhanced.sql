-- Enhance packages table with additional fields
ALTER TABLE packages ADD COLUMN IF NOT EXISTS services_included TEXT[] DEFAULT '{}';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS training_sessions  INT DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS color              TEXT DEFAULT '#F06418';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_featured        BOOLEAN DEFAULT FALSE;

-- Update existing packages with their included services
UPDATE packages SET
  services_included = ARRAY['Gym'],
  color = '#F06418',
  training_sessions = 0
WHERE name = 'Gym';

UPDATE packages SET
  services_included = ARRAY['Gym', 'Cardio'],
  color = '#2563EB',
  training_sessions = 0
WHERE name = 'Gym with Cardio';

UPDATE packages SET
  services_included = ARRAY['Gym', 'Cardio', 'Personal Training', 'METCON'],
  color = '#7C3AED',
  training_sessions = 8,
  is_featured = TRUE
WHERE name = 'Hybrid Workout';

UPDATE packages SET
  services_included = ARRAY['MMA', 'Gym'],
  color = '#DC2626',
  training_sessions = 12
WHERE name = 'MMA';

UPDATE packages SET
  services_included = ARRAY['CrossFit', 'Gym', 'Cardio'],
  color = '#D97706',
  training_sessions = 12
WHERE name = 'CrossFit';

UPDATE packages SET
  services_included = ARRAY['Table Tennis'],
  color = '#059669',
  training_sessions = 0
WHERE name = 'Table Tennis';

UPDATE packages SET
  services_included = ARRAY['Gym', 'Cardio', 'Personal Training', 'CrossFit', 'MMA', 'Nutritionist', 'Paid Locker', 'Shower Facility'],
  color = '#1A1A1A',
  training_sessions = 20,
  is_featured = TRUE
WHERE name = 'Premium';
