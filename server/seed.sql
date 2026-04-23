-- Seed sample rows
-- Run after schema.sql

INSERT INTO announcements (title, category, urgency, details, date_label, time_label, images)
VALUES
(
  'Lost & Found Verification Advisory',
  'Reminder',
  '',
  'Claimants for Lost & Found postings should prepare the correct item number, proof of ownership, and their official EAC email before opening the verification flow.',
  'April 16, 2026',
  '02:00 PM',
  ARRAY[
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80',
    'https://images.unsplash.com/photo-1496171367470-9ed9a91ea931?w=1200&q=80'
  ]::TEXT[]
),
(
  'Student Leadership Orientation Briefing',
  'Event',
  '',
  'All newly recognized student organization officers are requested to attend the orientation briefing on campus leadership protocols and event coordination timelines.',
  'April 14, 2026',
  '01:30 PM',
  ARRAY[
    'https://images.unsplash.com/photo-1511578314322-379afb476865?w=1200&q=80'
  ]::TEXT[]
)
ON CONFLICT DO NOTHING;

INSERT INTO lost_found_items (item_number, date_label, status, title, tag, caption, images)
VALUES
(
  'LF-1001',
  'April 18, 2025',
  'Unclaimed',
  'Black Leather Wallet',
  'Wallet',
  'Recovered near the student lounge on the ground floor. No name or ID found inside.',
  ARRAY['https://images.unsplash.com/photo-1627123424574-724758594e93?w=700&q=80']::TEXT[]
),
(
  'LF-1002',
  'April 19, 2025',
  'Unclaimed',
  'Black Backpack',
  'Bag',
  'Found inside the library, second floor near the reference section. Contains notebooks and a pencil case.',
  ARRAY[
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=700&q=80',
    'https://images.unsplash.com/photo-1622560480654-d96214fdc887?w=700&q=80'
  ]::TEXT[]
)
ON CONFLICT (item_number) DO NOTHING;

INSERT INTO portal_content (page_name, content_key, content_value)
VALUES
  ('home', 'hero_title', 'OSA Transaction Guide Portal'),
  ('home', 'hero_subtitle', 'Access OSA services, forms, and student support in one easy portal.'),
  ('home', 'services_heading', 'OSA Services'),
  ('home', 'services_description', 'These entries follow the Office of Student Affairs role in student life and development at EAC.'),
  ('home', 'manual_heading', 'Student Manual and Forms'),
  ('home', 'manual_description', 'Downloadable OSA forms and official references. Use the highlighted manual below as the primary document.'),
  ('home', 'modules_heading', 'Dedicated Module Pages'),
  ('home', 'modules_description', 'Serves as the central landing page, providing a clear overview of the portal and quick access to key features and services.'),
  ('about', 'hero_title', 'OSA Transaction Guide Portal'),
  ('about', 'hero_lead', 'The OSA Transaction Guide Portal is designed to support students in navigating Office of Student Affairs services with clarity and ease. It provides structured guidance for common transactions, along with an integrated chat assistant that offers real-time support and answers to frequently asked questions.'),
  ('about', 'eac_heading', 'Emilio Aguinaldo College'),
  ('about', 'eac_lead', 'Mission, vision, and philosophy are stated as published on the College website.'),
  ('about', 'osa_heading', 'Official Office of Student Affairs Summary (Cavite-Focused)'),
  ('about', 'osa_lead', 'The Office of Student Affairs (OSA) is an academic-support unit responsible for programs and services that develop the non-academic aspects of student life.')
ON CONFLICT (page_name, content_key) DO UPDATE
SET content_value = EXCLUDED.content_value,
    updated_at = NOW();

-- Tier 2: sample Student Manual / policy chunks (edit and expand in production; see admin/DB)
INSERT INTO student_manual_chunks (section_title, chunk_text, keywords)
VALUES
(
  'Conduct and discipline',
  'Reports on misconduct are evaluated through designated student-affairs protocols. Serious cases may involve documentation, conferences, and sanctions aligned with institutional policy. Students may seek guidance from OSA on filing or responding to reports.',
  ARRAY['conduct', 'discipline', 'misconduct', 'sanction', 'behavior', 'violation']::TEXT[]
),
(
  'Student organizations',
  'Recognized campus organizations coordinate with OSA on recognition, adviser requirements, activity guidelines, and annual reports. Officers should verify posting deadlines and clearance steps before major events.',
  ARRAY['organization', 'org', 'club', 'society', 'recognition', 'student', 'officer']::TEXT[]
),
(
  'OSA transactions (general)',
  'OSA facilitates non-academic student life services including scholarships, certificates, Lost & Found coordination, IDs (as posted), guidance on forms, and referrals related to student welfare. Fees, timelines, and requirements follow official postings at the Cavite campus.',
  ARRAY['osa', 'office', 'transaction', 'certificate', 'scholarship', 'appointment', 'forms']::TEXT[]
),
(
  'Student handbook reference',
  'Always refer to the official Student Handbook / Manual for authoritative rules on enrollment, uniforms (if applicable), attendance tied to student life policies, and campus norms. When the manual conflicts with rumor, defer to official text or staff confirmation.',
  ARRAY['manual', 'handbook', 'policy', 'rules', 'enrollment', 'campus']::TEXT[]
)
ON CONFLICT (section_title) DO UPDATE SET
  chunk_text = EXCLUDED.chunk_text,
  keywords = EXCLUDED.keywords,
  updated_at = NOW();
