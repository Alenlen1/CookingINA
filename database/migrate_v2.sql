
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='role'
  ) THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user';
  END IF;
END $$;

-- Add approval columns to recipes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='recipes' AND column_name='status'
  ) THEN
    ALTER TABLE recipes ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='recipes' AND column_name='is_public'
  ) THEN
    ALTER TABLE recipes ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='recipes' AND column_name='admin_note'
  ) THEN
    ALTER TABLE recipes ADD COLUMN admin_note TEXT DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='recipes' AND column_name='reviewed_at'
  ) THEN
    ALTER TABLE recipes ADD COLUMN reviewed_at TIMESTAMP;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='recipes' AND column_name='reviewed_by'
  ) THEN
    ALTER TABLE recipes
      ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ================================================================
-- Promote the 'chef_admin' seed account to admin role
-- ================================================================
UPDATE users SET role = 'admin' WHERE username = 'chef_admin';

-- ================================================================
-- Approve all existing recipes so your site doesn't go dark
-- (existing recipes are assumed already reviewed / trusted)
-- ================================================================
UPDATE recipes
SET status = 'approved', is_public = TRUE
WHERE status = 'pending';


