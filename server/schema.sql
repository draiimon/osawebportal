-- OSA Portal PostgreSQL schema
-- Run with: psql -h <host> -U <user> -d admin -f server/schema.sql

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'Advisory',
  urgency TEXT DEFAULT '',
  details TEXT DEFAULT '',
  date_label TEXT DEFAULT '',
  time_label TEXT DEFAULT '',
  images TEXT[] DEFAULT '{}'::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lost_found_items (
  id BIGSERIAL PRIMARY KEY,
  item_number TEXT UNIQUE NOT NULL,
  date_label TEXT DEFAULT '',
  time_label TEXT DEFAULT '',
  status TEXT DEFAULT 'Unclaimed',
  title TEXT NOT NULL,
  tag TEXT DEFAULT 'Personal Item',
  caption TEXT DEFAULT '',
  images TEXT[] DEFAULT '{}'::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lost_found_claims (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  item_id BIGINT NOT NULL REFERENCES lost_found_items(id) ON DELETE CASCADE,
  claim_details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_content (
  id BIGSERIAL PRIMARY KEY,
  page_name TEXT NOT NULL,
  content_key TEXT NOT NULL,
  content_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_name, content_key)
);

-- Optional indexes for faster filtering/search
CREATE INDEX IF NOT EXISTS idx_announcements_active_created
  ON announcements (is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lf_items_active_created
  ON lost_found_items (is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lf_claims_item_created
  ON lost_found_claims (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_content_page
  ON portal_content (page_name, content_key);

CREATE TABLE IF NOT EXISTS email_otp_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ NOT NULL,
  verify_attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otp_expires ON email_otp_codes (expires_at);

-- Per-email daily OTP quota (default 5/day). Persists across OTP row deletion
-- so the quota isn't reset just because a code was verified or expired.
CREATE TABLE IF NOT EXISTS email_otp_daily_quota (
  email TEXT NOT NULL,
  day DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (email, day)
);
CREATE INDEX IF NOT EXISTS idx_email_otp_quota_day ON email_otp_daily_quota (day);

-- Short-lived tokens issued after OTP verify, used to create a chat session
CREATE TABLE IF NOT EXISTS chat_auth_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  student_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  -- session_id is nullable + ON DELETE SET NULL so the conversation history
  -- is preserved for OSA records even if the chat_session row is later removed.
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_auth_tokens_expires ON chat_auth_tokens (expires_at);

-- Tier 1: Curated FAQ entries (pre-validated by OSA staff)
CREATE TABLE IF NOT EXISTS faq_entries (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  times_matched INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_category ON faq_entries (category, is_active);
CREATE INDEX IF NOT EXISTS idx_faq_keywords_gin ON faq_entries USING gin (keywords);

-- Tier 2 RAG-lite: searchable excerpts (Student Manual / policy text curated by staff)
CREATE TABLE IF NOT EXISTS student_manual_chunks (
  id BIGSERIAL PRIMARY KEY,
  section_title TEXT NOT NULL DEFAULT '',
  chunk_text TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section_title)
);

CREATE INDEX IF NOT EXISTS idx_manual_chunks_keywords ON student_manual_chunks USING gin (keywords);

-- Tier 3: Escalation tickets (async ticketing)
CREATE TABLE IF NOT EXISTS escalation_tickets (
  id BIGSERIAL PRIMARY KEY,
  case_id TEXT UNIQUE NOT NULL,
  -- session_id is nullable + ON DELETE SET NULL so the ticket (which is OSA
  -- data) survives if the originating chat_session row is later removed.
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  student_email TEXT NOT NULL,
  student_name TEXT NOT NULL,
  concern TEXT NOT NULL,
  ticket_type TEXT NOT NULL DEFAULT 'general',
  claim_item_number TEXT,
  appointment_track TEXT,
  appointment_status TEXT NOT NULL DEFAULT 'pending_staff_schedule',
  preferred_day TEXT,
  preferred_time_window TEXT,
  appointment_datetime TIMESTAMPTZ,
  appointment_location TEXT,
  appointment_notes TEXT,
  appointment_approved_at TIMESTAMPTZ,
  appointment_approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  staff_reply TEXT,
  promote_to_faq BOOLEAN NOT NULL DEFAULT false,
  faq_question TEXT,
  faq_answer TEXT,
  faq_category TEXT DEFAULT 'General',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON escalation_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_session ON escalation_tickets (session_id);

-- Chatbot v2 cache + memory (uses same PostgreSQL database)
CREATE TABLE IF NOT EXISTS chatbot_response_cache (
  cache_key TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_cache_updated_at
  ON chatbot_response_cache (updated_at DESC);

CREATE TABLE IF NOT EXISTS chatbot_conversation_memory (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_memory_conversation
  ON chatbot_conversation_memory (conversation_id, created_at ASC);

-- Existing databases: add columns without breaking installs that already ran older schema.sql
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'general';
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS claim_item_number TEXT;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_track TEXT;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_status TEXT NOT NULL DEFAULT 'pending_staff_schedule';
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS preferred_day TEXT;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS preferred_time_window TEXT;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_datetime TIMESTAMPTZ;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_location TEXT;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_notes TEXT;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_approved_at TIMESTAMPTZ;
ALTER TABLE escalation_tickets ADD COLUMN IF NOT EXISTS appointment_approved_by TEXT;
