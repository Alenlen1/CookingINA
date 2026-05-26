ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE users SET role = 'admin' WHERE username = 'chef_admin';

UPDATE recipes
SET status = 'approved', is_public = TRUE
WHERE status = 'pending';