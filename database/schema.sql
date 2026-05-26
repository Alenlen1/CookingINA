-- ============================================================
-- Cooking INA — PostgreSQL Schema
-- Run: psql Cooking INA < database/schema.sql
-- ============================================================

-- Drop tables if re-running
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;
DROP TABLE IF EXISTS favorites CASCADE;
DROP TABLE IF EXISTS recipe_steps CASCADE;
DROP TABLE IF EXISTS recipe_allergens CASCADE;
DROP TABLE IF EXISTS ingredients CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(120) UNIQUE NOT NULL,
    password_hash TEXT         NOT NULL,
    bio           TEXT         DEFAULT '',
    profile_image VARCHAR(255) DEFAULT '',
    created_at    TIMESTAMP    DEFAULT NOW()
);

-- ============================================================
-- RECIPES
-- ============================================================
CREATE TABLE recipes (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    name        VARCHAR(120) NOT NULL,
    description TEXT         NOT NULL,
    emoji       VARCHAR(10)  DEFAULT '🍽️',
    image_path  VARCHAR(255) DEFAULT '',
    cook_time   VARCHAR(30)  NOT NULL,
    servings    INTEGER      NOT NULL DEFAULT 4,
    is_spicy    BOOLEAN      DEFAULT FALSE,
    is_quick    BOOLEAN      DEFAULT FALSE,
    is_budget   BOOLEAN      DEFAULT FALSE,
    created_at  TIMESTAMP    DEFAULT NOW()
);

-- ============================================================
-- INGREDIENTS
-- ============================================================
CREATE TABLE ingredients (
    id        SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    name      VARCHAR(100) NOT NULL,
    price     INTEGER      NOT NULL DEFAULT 0,
    sort_order INTEGER     DEFAULT 0
);

-- ============================================================
-- RECIPE STEPS
-- ============================================================
CREATE TABLE recipe_steps (
    id         SERIAL PRIMARY KEY,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    step_num   INTEGER NOT NULL,
    instruction TEXT   NOT NULL
);

-- ============================================================
-- ALLERGENS
-- ============================================================
CREATE TABLE recipe_allergens (
    id        SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    allergen  VARCHAR(50) NOT NULL
);

-- ============================================================
-- FAVORITES
-- ============================================================
CREATE TABLE favorites (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, recipe_id)
);

-- ============================================================
-- RATINGS
-- ============================================================
CREATE TABLE ratings (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    rating    INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, recipe_id)
);

-- ============================================================
-- REVIEWS / COMMENTS
-- ============================================================
CREATE TABLE reviews (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    comment    TEXT    NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_replies (
    id         SERIAL PRIMARY KEY,
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_reply_id INTEGER REFERENCES review_replies(id) ON DELETE CASCADE,
    comment    TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
-- ============================================================
-- SAMPLE DATA — Demo user
-- password: demo1234  (bcrypt hash generated at runtime)
-- ============================================================
-- Recipes inserted at app startup via seed_db() in app.py
