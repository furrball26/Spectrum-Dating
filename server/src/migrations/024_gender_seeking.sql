-- Identity + seeking for directed matching.
--  gender:   '' | 'woman' | 'man' | 'nonbinary' | 'other'
--  pronouns: free text (e.g. 'she/her')
--  seeking:  comma-list subset of {woman,man,nonbinary}; '' = open to everyone
ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN pronouns TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN seeking TEXT NOT NULL DEFAULT '';
