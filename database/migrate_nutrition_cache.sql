-- Add nutrition cache column to recipes table
-- Run this once on your existing database
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS nutrition_json TEXT DEFAULT NULL;
