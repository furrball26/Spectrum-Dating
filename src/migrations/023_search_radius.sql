-- Per-user search radius (miles) for distance-based matching. 0 = "Anywhere"
-- (no radius filter). Set from the profile editor; applied in candidate filtering.
ALTER TABLE profiles ADD COLUMN search_radius_miles INTEGER NOT NULL DEFAULT 0;
