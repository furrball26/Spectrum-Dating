-- Communication style (#14) — structured, matchable; existing comm_note free-text stays
ALTER TABLE profiles ADD COLUMN comm_directness TEXT NOT NULL DEFAULT '';  -- '' | 'direct' | 'softened'
ALTER TABLE profiles ADD COLUMN comm_literal    TEXT NOT NULL DEFAULT '';  -- '' | 'literal' | 'playful'
ALTER TABLE profiles ADD COLUMN comm_cadence    TEXT NOT NULL DEFAULT '';  -- '' | 'instant' | 'daily' | 'whenever'
-- Sensory / environment (#13)
ALTER TABLE profiles ADD COLUMN sensory_environment TEXT NOT NULL DEFAULT ''; -- '' | 'quiet' | 'lively' | 'either'
ALTER TABLE profiles ADD COLUMN sensory_lighting    TEXT NOT NULL DEFAULT ''; -- '' | 'dim' | 'bright' | 'either'
ALTER TABLE profiles ADD COLUMN social_duration     TEXT NOT NULL DEFAULT ''; -- '' | 'short' | 'medium' | 'long'
-- Context card (#17) — user-authored "how to talk to me" disclosure
ALTER TABLE profiles ADD COLUMN context_card TEXT NOT NULL DEFAULT '';
