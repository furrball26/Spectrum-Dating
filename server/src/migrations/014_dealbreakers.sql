ALTER TABLE profiles ADD COLUMN wants_children TEXT NOT NULL DEFAULT '';   -- '' | 'yes' | 'no' | 'open'
ALTER TABLE profiles ADD COLUMN smoking        TEXT NOT NULL DEFAULT '';   -- '' | 'no' | 'sometimes' | 'yes'
ALTER TABLE profiles ADD COLUMN drinking       TEXT NOT NULL DEFAULT '';   -- '' | 'no' | 'sometimes' | 'yes'
ALTER TABLE profiles ADD COLUMN db_wants_children INTEGER NOT NULL DEFAULT 0; -- deal-breaker flags
ALTER TABLE profiles ADD COLUMN db_non_smoker     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN db_must_be_local  INTEGER NOT NULL DEFAULT 0;
