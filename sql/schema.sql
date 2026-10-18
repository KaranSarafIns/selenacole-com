-- SelenaCole.com backend schema: site_selenacole (shared Supabase project).
-- Placed per STANDARDS.md 3.1b on the shared host project (Crystal's).
-- Applied via the Supabase Management API (/v1/projects/{ref}/database/query).
-- Conventions:
--   * add / edit / hide — NEVER delete. Every content table carries `show`.
--   * No Studio delete buttons exist anywhere (STANDARDS.md 3.6 / 3.13).
--   * Version history (3.17): every content edit snapshots into `versions`
--     via the admin API; retention = seeded original + last 3.
--   * Translatable content is one row per (key, lang) — matches the
--     content/<lang>.json seed contract and the versions(lang) column.
-- gen_random_uuid() needs pgcrypto (enabled on every Supabase project).

CREATE SCHEMA IF NOT EXISTS "site_selenacole";

-- ---------- admin auth (scrypt salt+hash, Raj sets the password via /api/admin/setup) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."admin_auth" (
  id integer NOT NULL,
  salt text NOT NULL,
  hash text NOT NULL,
  CONSTRAINT admin_auth_id_uniq UNIQUE (id)
);

-- ---------- rate limit store (Supabase-backed, holds across serverless instances) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."rate_limits" (
  key text NOT NULL,
  value jsonb,
  CONSTRAINT rate_limits_key_uniq UNIQUE (key)
);

-- ---------- public pages, one row per (page, lang) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."pages_content" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  page text NOT NULL,
  lang text NOT NULL,
  title text,
  subtitle text,
  body jsonb DEFAULT '[]'::jsonb,
  meta jsonb DEFAULT '{}'::jsonb,
  show boolean DEFAULT true,
  sort integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT pages_content_key_uniq UNIQUE (page, lang)
);

-- ---------- reels theatre ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."reels" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_key text NOT NULL,
  lang text NOT NULL,
  sort integer DEFAULT 0,
  show boolean DEFAULT true,
  video_url text,
  thumbnail_url text,
  title text,
  caption text,
  mood text,
  season text,
  duration text,
  featured boolean DEFAULT false,
  premiere_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reels_key_uniq UNIQUE (item_key, lang)
);

-- ---------- gallery sets + items ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."gallery_sets" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  set_key text NOT NULL,
  lang text NOT NULL,
  title text,
  description text,
  cover_image text,
  sort integer DEFAULT 0,
  show boolean DEFAULT true,
  season text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT gallery_sets_key_uniq UNIQUE (set_key, lang)
);

CREATE TABLE IF NOT EXISTS "site_selenacole"."gallery_items" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_key text NOT NULL,
  set_key text NOT NULL,
  lang text NOT NULL,
  sort integer DEFAULT 0,
  show boolean DEFAULT true,
  image_url text,
  image_url_phone text,
  caption text,
  alt text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT gallery_items_key_uniq UNIQUE (item_key, lang)
);
CREATE INDEX IF NOT EXISTS gallery_items_set_idx
  ON "site_selenacole"."gallery_items" (set_key, lang, sort);

-- ---------- journal ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."journal_posts" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_key text NOT NULL,
  lang text NOT NULL,
  title text,
  slug text,
  excerpt text,
  body text,
  cover_image text,
  published_at timestamp with time zone,
  show boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT journal_posts_key_uniq UNIQUE (post_key, lang)
);

-- ---------- brutal truth: categories + articles ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."bt_categories" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cat_key text NOT NULL,
  lang text NOT NULL,
  name text,
  slug text,
  description text,
  sort integer DEFAULT 0,
  show boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bt_categories_key_uniq UNIQUE (cat_key, lang)
);

CREATE TABLE IF NOT EXISTS "site_selenacole"."bt_articles" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  article_key text NOT NULL,
  lang text NOT NULL,
  cat_key text,
  title text,
  slug text,
  excerpt text,
  body text,
  cover_image text,
  published boolean DEFAULT false,
  published_at timestamp with time zone,
  sort integer DEFAULT 0,
  draft_note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bt_articles_key_uniq UNIQUE (article_key, lang)
);
CREATE INDEX IF NOT EXISTS bt_articles_cat_idx
  ON "site_selenacole"."bt_articles" (cat_key, lang);

-- ---------- chatbot replies (Selena-voiced), per (key, lang) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."chatbot_replies" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  lang text NOT NULL,
  question text,
  answer text,
  keywords text,
  show boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chatbot_replies_key_uniq UNIQUE (key, lang)
);

-- ---------- FAQs ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."faqs" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  lang text NOT NULL,
  q text,
  a text,
  sort integer DEFAULT 0,
  show boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT faqs_key_uniq UNIQUE (key, lang)
);

-- ---------- inboxes (no public read; Studio only) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."enquiries" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  email text,
  company text,
  topic text,
  message text,
  status text DEFAULT 'new',
  notify_status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "site_selenacole"."fan_messages" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  email text,
  message text,
  status text DEFAULT 'new',
  notify_status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "site_selenacole"."newsletter_signups" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  lang text,
  status text DEFAULT 'pending',
  token text,
  created_at timestamp with time zone DEFAULT now(),
  confirmed_at timestamp with time zone,
  CONSTRAINT newsletter_signups_email_uniq UNIQUE (email)
);

-- ---------- site settings (single row, id=1) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."site_settings" (
  id integer NOT NULL,
  brand_name text,
  tagline jsonb DEFAULT '{}'::jsonb,
  hero_image text,
  about_image text,
  socials jsonb DEFAULT '{}'::jsonb,
  announcement jsonb DEFAULT '{}'::jsonb,
  emails jsonb DEFAULT '{}'::jsonb,
  theme text DEFAULT 'gold',
  seasonal_skin text DEFAULT 'none',
  chatbot_name text DEFAULT 'Selena''s Concierge',
  chatbot_greeting jsonb DEFAULT '{}'::jsonb,
  chatbot_fallback jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT site_settings_id_uniq UNIQUE (id)
);

-- ---------- toggle board (single source of truth for all switches) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."toggles" (
  key text NOT NULL,
  enabled boolean DEFAULT true,
  label text,
  grp text,
  CONSTRAINT toggles_key_uniq UNIQUE (key)
);

-- ---------- version history (STANDARDS.md 3.17) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."versions" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_type text NOT NULL,
  item_id text NOT NULL,
  lang text,
  data jsonb NOT NULL,
  seed_original boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_item_idx
  ON "site_selenacole"."versions" (item_type, item_id, lang, created_at DESC);

-- ---------- analytics events ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."analytics_events" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text,
  path text,
  lang text,
  at timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_at_idx
  ON "site_selenacole"."analytics_events" (at DESC);

-- ---------- newsletter: issues (draft -> approved -> queued -> sent) ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."newsletter_issues" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_no integer NOT NULL,
  subject text,
  subject_i18n jsonb DEFAULT '{}'::jsonb,
  sections jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'draft',
  scheduled_for timestamp with time zone,
  sent_at timestamp with time zone,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT newsletter_issues_no_uniq UNIQUE (issue_no),
  CONSTRAINT newsletter_issues_status_chk
    CHECK (status IN ('draft', 'approved', 'queued', 'sent'))
);

-- ---------- newsletter: per-subscriber send log ----------
CREATE TABLE IF NOT EXISTS "site_selenacole"."newsletter_sends" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL,
  email text NOT NULL,
  status text DEFAULT 'pending',
  attempts integer DEFAULT 0,
  error text,
  sent_at timestamp with time zone DEFAULT now(),
  CONSTRAINT newsletter_sends_issue_email_uniq UNIQUE (issue_id, email),
  CONSTRAINT newsletter_sends_status_chk
    CHECK (status IN ('pending', 'sent', 'failed'))
);
CREATE INDEX IF NOT EXISTS newsletter_sends_issue_idx
  ON "site_selenacole"."newsletter_sends" (issue_id);

-- ---------- grants from day one (STANDARDS.md 3.3) ----------
GRANT USAGE ON SCHEMA "site_selenacole" TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA "site_selenacole" TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "site_selenacole"
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
