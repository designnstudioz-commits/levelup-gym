-- Seed dummy trainers for Level Up Fitness Club
INSERT INTO staff_members (full_name, role, phone, email, salary, joining_date, status) VALUES
  ('Usman Tariq',    'Trainer', '0300-1234567', 'usman.tariq@levelupfitness.com.pk',   45000, '2024-01-15', 'active'),
  ('Bilal Ahmed',    'Trainer', '0311-9876543', 'bilal.ahmed@levelupfitness.com.pk',   40000, '2024-03-01', 'active'),
  ('Hamza Khalid',   'Trainer', '0333-5556789', 'hamza.khalid@levelupfitness.com.pk',  50000, '2023-11-10', 'active'),
  ('Asad Mehmood',   'Trainer', '0321-4447890', 'asad.mehmood@levelupfitness.com.pk',  42000, '2025-01-20', 'active'),
  ('Rizwan Sheikh',  'Trainer', '0345-3331234', 'rizwan.sheikh@levelupfitness.com.pk', 38000, '2025-06-01', 'active'),
  ('Faizan Butt',    'Trainer', '0312-7778901', 'faizan.butt@levelupfitness.com.pk',   48000, '2024-07-15', 'active')
ON CONFLICT DO NOTHING;
