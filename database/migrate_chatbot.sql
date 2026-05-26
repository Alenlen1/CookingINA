-- ================================================================
-- Cooking INA — AI Chatbot Migration
-- Run: psql -U postgres -d cookingina -f migrate_chatbot.sql
-- Safe to run multiple times (IF NOT EXISTS checks)
-- ================================================================

-- 1. Chat conversations (one session per conversation)
CREATE TABLE IF NOT EXISTS chat_conversations (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL DEFAULT 'New Conversation',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 2. Individual messages inside a conversation
CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_chat_conv_user
    ON chat_conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv
    ON chat_messages(conversation_id, created_at ASC);

-- ================================================================
-- Done! New tables:
--   chat_conversations  (id, user_id, title, created_at, updated_at)
--   chat_messages       (id, conversation_id, role, content, created_at)
-- ================================================================
