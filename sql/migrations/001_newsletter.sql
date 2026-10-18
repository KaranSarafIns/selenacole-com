-- Migration 001: newsletter issues + sends (biweekly auto-newsletter, Raj 2026-10-18).
-- Idempotent: all CREATEs are IF NOT EXISTS.

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


-- grants for the new tables (matches schema.sql day-one grants)
GRANT ALL ON ALL TABLES IN SCHEMA "site_selenacole" TO anon, authenticated, service_role;
