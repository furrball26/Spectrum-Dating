-- Token version for immediate JWT revocation on sign-out
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
