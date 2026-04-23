const db = require("../db");

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL CHECK (role IN ('STUDENT','ADMIN')),
    is_verified BOOLEAN NOT NULL DEFAULT false,
    otp TEXT,
    otp_expires TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ESCALATED','CLOSED'))
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('USER','BOT','ADMIN')),
    content TEXT NOT NULL,
    tier_used TEXT NOT NULL CHECK (tier_used IN ('FAQ','RAG','ADMIN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
    admin_reply TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    preferred_date TIMESTAMPTZ NOT NULL,
    confirmed_date TIMESTAMPTZ,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','RESCHEDULED','CANCELLED')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS email_otp_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verify_attempts INT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_email_otp_expires ON email_otp_codes (expires_at)`,
  `CREATE TABLE IF NOT EXISTS email_otp_daily_quota (
    email TEXT NOT NULL,
    day DATE NOT NULL,
    count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (email, day)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_email_otp_quota_day ON email_otp_daily_quota (day)`,
  // Keep legacy chat/escalation flow compatible when DB was initialized from older schema.
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'general'`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS claim_item_number TEXT`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_track TEXT`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_status TEXT NOT NULL DEFAULT 'pending_staff_schedule'`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS preferred_day TEXT`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS preferred_time_window TEXT`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_datetime TIMESTAMPTZ`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_location TEXT`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_notes TEXT`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_approved_at TIMESTAMPTZ`,
  `ALTER TABLE IF EXISTS escalation_tickets ADD COLUMN IF NOT EXISTS appointment_approved_by TEXT`,
  // Legacy table already exists; add v2 columns without removing current fields.
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS content TEXT`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS type TEXT`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS posted_by UUID`,
  // Legacy table already exists; add v2 columns without removing current fields.
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS posted_by UUID`,
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS item_name TEXT`,
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS found_location TEXT`,
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS found_date DATE`,
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS image_url TEXT`,
  `ALTER TABLE lost_found_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE TABLE IF NOT EXISTS lost_found_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id BIGINT REFERENCES lost_found_items(id) ON DELETE CASCADE,
    claimant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS osa_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    fees TEXT NOT NULL DEFAULT '',
    processing_time TEXT NOT NULL DEFAULT '',
    office_location TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true
  )`,
  // RAG v2 — Gemini embedding-001 = 768 dims. Hybrid vector + keyword search.
  `CREATE TABLE IF NOT EXISTS rag_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id TEXT UNIQUE NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    article TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT '',
    keywords TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    bot_routing TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'EAC Student Manual 2021',
    embedding vector(768),
    token_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rag_chunks_keywords ON rag_chunks USING GIN (keywords)`,
  `CREATE INDEX IF NOT EXISTS idx_rag_chunks_active ON rag_chunks (is_active) WHERE is_active = true`,
  // HNSW requires the embedding column to exist; wrap in DO block so we can skip gracefully on older pgvector.
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rag_chunks_embedding'
     ) THEN
       BEGIN
         EXECUTE 'CREATE INDEX idx_rag_chunks_embedding ON rag_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
       EXCEPTION WHEN others THEN
         RAISE NOTICE 'HNSW index creation skipped: %', SQLERRM;
       END;
     END IF;
   END $$;`,
];

async function ensureV2Schema() {
  for (const sql of statements) {
    try {
      await db.query(sql);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[schema-v2]", error?.message || error);
    }
  }
}

module.exports = { ensureV2Schema };
