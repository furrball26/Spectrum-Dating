-- Per-user read cursors for conversations
ALTER TABLE conversations ADD COLUMN last_read_at_a INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN last_read_at_b INTEGER NOT NULL DEFAULT 0;
