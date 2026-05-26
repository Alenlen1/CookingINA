-- ================================================================
-- ChefAI — Migration: Reactions + Comment Image Upload
-- Run: psql -U postgres -d CHEFAI -f database/migrate_reactions.sql
-- Safe to run multiple times (IF NOT EXISTS checks)
-- ================================================================

-- 1. Add image_path column to reviews
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='reviews' AND column_name='image_path'
  ) THEN
    ALTER TABLE reviews ADD COLUMN image_path TEXT DEFAULT NULL;
  END IF;
END $$;

-- 2. Create review_reactions table
CREATE TABLE IF NOT EXISTS review_reactions (
    id         SERIAL PRIMARY KEY,
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    reaction   VARCHAR(10) NOT NULL CHECK (reaction IN ('like', 'dislike')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(review_id, user_id)
);

-- Done!
-- New columns/tables added:
--   reviews.image_path         TEXT (nullable)
--   review_reactions table     (review_id, user_id, reaction, created_at)
