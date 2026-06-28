-- Archive all existing packages (preserve for historical member references)
UPDATE packages SET deleted_at = NOW(), status = 'inactive' WHERE deleted_at IS NULL;

-- Insert all new packages from June 2026 brochure
INSERT INTO packages (name, type, duration_months, admission_fee, monthly_fee, max_members, description, status) VALUES

-- ── Core Memberships ─────────────────────────────────────────────────
('Gym',               'Individual', 1, 15000, 10000, 1, 'Build strength. Build you.',                                    'active'),
('Zumba',             'Individual', 1, 15000, 12000, 1, 'Dance. Sweat. Feel alive.',                                     'active'),
('CrossFit / MMA',    'Individual', 1, 15000,  8000, 1, 'Stronger everyday. Better everyday.',                           'active'),
('Hybrid',            'Individual', 1, 15000, 12000, 1, 'Female only. Strength. Cardio. Functional.',                    'active'),
('Pilates Monthly',   'Individual', 1, 15000, 20000, 1, '4 sessions per week. Strength + Mobility + Balance.',           'active'),

-- ── Vault Packages ───────────────────────────────────────────────────
('Infinity Vault',    'Individual', 1, 15000, 25000, 1, 'Gym + 4 Sessions Jacuzzi + 2 Sessions Ice Plunge + 10 Frames Snooker + Table Tennis + 10 Frames Pool Game + Unlimited Chess & Carom Board', 'active'),
('Wellness Vault',    'Individual', 1, 15000, 12000, 1, 'Gym + 4 Sessions Jacuzzi',                                     'active'),
('Recovery Vault',    'Individual', 1, 15000, 18000, 1, 'Gym + 4 Sessions Jacuzzi & Ice Plunge',                        'active'),
('Family Vault',      'Family',     1, 15000,     0, 4, 'Pay parents registrations & get 2 kids membership free + 10% off monthly fee', 'active'),
('Tribe Vault',       'Individual', 1,  7500,     0, 1, '50% off registration fee with 4 friends + 10% off monthly fee', 'active'),

-- ── Personal Training ────────────────────────────────────────────────
('Personal Training — Bronze',   'Individual', 1, 0, 15000, 1, 'Your goals. Your coach. Bronze level. Gym fee applies separately.', 'active'),
('Personal Training — Silver',   'Individual', 1, 0, 20000, 1, 'Your goals. Your coach. Silver level. Gym fee applies separately.', 'active'),
('Personal Training — Gold',     'Individual', 1, 0, 25000, 1, 'Your goals. Your coach. Gold level. Gym fee applies separately.',   'active'),
('Personal Training — Platinum', 'Individual', 1, 0, 40000, 1, 'Your goals. Your coach. Platinum level. Gym fee applies separately.', 'active'),

-- ── Recovery (per session / monthly) ────────────────────────────────
('Jacuzzi',             'Individual', 1, 0,  1000, 1, 'Recovery. Rs 1,000 per session.',          'active'),
('Ice Plunge',          'Individual', 1, 0,  2000, 1, 'Recovery. Rs 2,000 per session.',          'active'),
('Steam Room / Sauna',  'Individual', 1, 0,  1000, 1, 'Recovery. Rs 1,000 per session.',          'active'),
('Physiotherapy',       'Individual', 1, 0,  2500, 1, 'Recovery. Rs 2,500 per session.',          'active'),
('Nutritionist',        'Individual', 1, 0,  6000, 1, 'Monthly nutrition plan. Rs 6,000/month.',  'active'),
('Pilates Session',     'Individual', 1, 0,  2500, 1, 'Single session. Rs 2,500 per session.',    'active'),

-- ── Amenities ────────────────────────────────────────────────────────
('Table Tennis',        'Daily', 1, 0,  5000, 1, 'Monthly membership.',                          'active'),
('Table Tennis PT',     'Daily', 1, 0, 15000, 1, 'Monthly with personal trainer.',               'active'),
('Kids Play Area',      'Daily', 1, 0,  4000, 1, 'A safe and fun environment for your little champions.', 'active');
