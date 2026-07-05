-- Report-an-audio — durable evidence snapshot on `reports`.
--
-- A viewer can report a specific approved audio clip. We reference the clip
-- (reported_audio_id) AND snapshot its transcript (reported_audio_transcript)
-- so the evidence survives even if the uploader later deletes the clip or their
-- whole account — mirroring reports.reported_message (044) + the ON DELETE SET
-- NULL guarantee (030). The audio bytes may vanish; the transcript text stays.
--
-- ADD COLUMN ONLY — never rebuild `reports` (the abuse-evidence trail, see 030).
-- Idempotent via the runner's "duplicate column name" tolerance (src/db.js).
ALTER TABLE reports ADD COLUMN reported_audio_id TEXT;
ALTER TABLE reports ADD COLUMN reported_audio_transcript TEXT;
