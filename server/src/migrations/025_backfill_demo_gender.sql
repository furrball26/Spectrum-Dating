-- Give the sample users a gender + pronouns so directed matching has data to
-- work with (otherwise a viewer who is "seeking women" would see an empty deck).
-- Inferred from their randomuser.me portrait path (men/* vs women/*). Idempotent.
UPDATE profiles SET gender = CASE
    WHEN photo_url LIKE '%/men/%'   THEN 'man'
    WHEN photo_url LIKE '%/women/%' THEN 'woman'
    ELSE gender END
WHERE gender = '' AND photo_url LIKE 'https://randomuser.me/%';

UPDATE profiles SET pronouns = CASE
    WHEN gender = 'man'   THEN 'he/him'
    WHEN gender = 'woman' THEN 'she/her'
    ELSE pronouns END
WHERE pronouns = '' AND gender IN ('man', 'woman');
