-- Discovery age-range preference. Defaults 18–99 = no effective filter.
-- Candidates outside [pref_age_min, pref_age_max] are hidden from Discover.
ALTER TABLE profiles ADD COLUMN pref_age_min INTEGER NOT NULL DEFAULT 18;
ALTER TABLE profiles ADD COLUMN pref_age_max INTEGER NOT NULL DEFAULT 99;
