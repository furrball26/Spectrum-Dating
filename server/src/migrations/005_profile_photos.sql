-- Add photo_url to profiles
ALTER TABLE profiles ADD COLUMN photo_url TEXT NOT NULL DEFAULT '';

-- Add photo_url column to message_attachments public url tracking
ALTER TABLE message_attachments ADD COLUMN public_url TEXT NOT NULL DEFAULT '';
