-- Add specialization field to staff_members for trainer expertise
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS specialization TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS bio TEXT;

-- Update seeded trainers with specializations
UPDATE staff_members SET specialization = 'Strength & Conditioning' WHERE full_name = 'Usman Tariq';
UPDATE staff_members SET specialization = 'CrossFit & HIIT'         WHERE full_name = 'Bilal Ahmed';
UPDATE staff_members SET specialization = 'MMA & Combat Sports'      WHERE full_name = 'Hamza Khalid';
UPDATE staff_members SET specialization = 'Bodybuilding & Nutrition' WHERE full_name = 'Asad Mehmood';
UPDATE staff_members SET specialization = 'Cardio & Weight Loss'     WHERE full_name = 'Rizwan Sheikh';
UPDATE staff_members SET specialization = 'Functional Fitness'       WHERE full_name = 'Faizan Butt';
