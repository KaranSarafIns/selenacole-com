# SelenaCole.com

Selena Cole's personal website — Team Selena flagship. Gold (Fairytale Gold) launch
theme with Noir (Casino Noir) + Wine (Royal Evening) one-click Studio themes.
14 languages, reels theatre, gallery, journal, brutal-truth articles, Partners
page, Selena's Concierge chatbot, accessibility widget, newsletter engine.

## Deploy (Vercel)

Import this repo in Vercel (Framework Preset: Other). Set these env vars:

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | service_role key — server only |
| `SUPABASE_SCHEMA` | `site_selenacole` |
| `SESSION_SECRET` | random 32+ chars (admin sessions) |
| `CRON_SECRET` | random 32+ chars (`/api/cron/newsletter`) |
| `RESEND_API_KEY` | Resend — form alerts, confirmations, newsletter sends |
| `NOTIFY_FROM` | sender address for outgoing mail |
| `SITE_URL` | `https://selenacole.com` |

Then: set the custom domain `selenacole.com` in Vercel, deploy, verify
Search Console + submit the sitemap.

## Develop

```bash
node build.js     # regenerate the 294 static pages from content/*.json (repo root: ../content)
```

Content lives in `../content/<lang>.json` (14 languages); media manifest in
`../media/MANIFEST.json`. The Studio (`/admin`, password set at first run)
edits everything live via Supabase — static pages are the SEO shell, the
`/api/content` endpoint serves live Studio content.

## Backend

Supabase schema `site_selenacole` on the shared project. Seed:
`node scripts/seed.js` (idempotent). Newsletter cron: `POST /api/cron/newsletter`
every ~6h with `CRON_SECRET` bearer. Keepalive: `GET /api/health` every ~96h.
