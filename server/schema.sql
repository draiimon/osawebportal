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
