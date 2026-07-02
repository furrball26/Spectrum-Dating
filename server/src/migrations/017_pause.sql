ALTER TABLE profiles ADD COLUMN paused INTEGER NOT NULL DEFAULT 0; -- pause/snooze: 1 hides the user from others' Discover; they can still use the app
