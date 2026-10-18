#!/usr/bin/env python3
"""One-shot provisioning of the site_selenacole schema on the shared host project.

Runs site/sql/schema.sql through the Supabase Management API, exposes the schema
to PostgREST (read-modify-write, never clobbers existing schemas), and registers
the site in public.site_registry.

Snapshot-then-verify: captures public-schema table list before and after, and
fails loudly if anything outside site_selenacole changed.
"""
from __future__ import annotations

import json
import sys
import urllib.request
import urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response  # noqa: E402

BASE = "https://api.supabase.com"
PROJECT_REF = "jqestqdxgouytixpxcso"   # shared host (Crystal's project)
SCHEMA = "site_selenacole"
SQL_FILE = "/home/hatch/workspace/selenacole-com/site/sql/schema.sql"


def api(method, path, payload=None):
    req = urllib.request.Request(BASE + path, method=method)
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    add_surrogate_to_request(req, "custom.supabase", allowed_hosts=("api.supabase.com",))
    try:
        with urllib.request.urlopen(req, data=body, timeout=60) as resp:
            return read_json_response(resp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:600]
        raise SystemExit(f"API {exc.code} {method} {path}: {detail}")


def query(sql, read_only=False):
    return api("POST", f"/v1/projects/{PROJECT_REF}/database/query",
               {"query": sql, "read_only": read_only})


def public_tables():
    # Everything EXCEPT our own new schema: must be byte-identical before/after.
    rows = query("SELECT table_schema, table_name FROM information_schema.tables "
                 "WHERE table_schema NOT IN ('pg_catalog','information_schema', "
                 f"'{SCHEMA}') "
                 "ORDER BY table_schema, table_name", read_only=True)
    return json.dumps(rows, sort_keys=True)


def main():
    before = public_tables()

    with open(SQL_FILE) as f:
        sql = f.read()
    # strip full-line comments before splitting on ';'
    sql = "\n".join(l for l in sql.splitlines()
                    if not l.lstrip().startswith("--"))
    stmts = [s.strip() for s in sql.split(";") if s.strip()]
    n = 0
    for stmt in stmts:
        query(stmt)
        n += 1
    print(f"schema.sql applied: {n} statements ok")

    # PostgREST exposed schemas: read current, append ours, write back
    cfg = api("GET", f"/v1/projects/{PROJECT_REF}/postgrest")
    current = (cfg.get("db_schema") if isinstance(cfg, dict) else "") or ""
    schemas = [s for s in current.split(",") if s]
    if SCHEMA not in schemas:
        schemas.append(SCHEMA)
        api("PATCH", f"/v1/projects/{PROJECT_REF}/postgrest",
            {"db_schema": ",".join(schemas)})
        print("postgrest db_schema ->", ",".join(schemas))
    else:
        print("postgrest db_schema already exposes", SCHEMA)

    # site registry
    query("""CREATE TABLE IF NOT EXISTS public.site_registry (
      slug text NOT NULL, display_name text,
      created_at timestamp with time zone DEFAULT now(),
      status text DEFAULT 'active', notes text)""")
    query(f"""INSERT INTO public.site_registry (slug, display_name, notes)
      SELECT 'selenacole', 'SelenaCole.com', 'Selena Cole personal site — backend track'
      WHERE NOT EXISTS (SELECT 1 FROM public.site_registry WHERE slug = 'selenacole')""")
    print("site_registry ensured")

    # verify: our tables exist
    rows = query(f"SELECT count(*) AS c FROM information_schema.tables "
                 f"WHERE table_schema = '{SCHEMA}'", read_only=True)
    print("tables in", SCHEMA, "->", json.dumps(rows)[:200])

    after = public_tables()
    if before != after:
        raise SystemExit("UNEXPECTED schema change outside site_selenacole!")
    print("schema snapshot identical before/after (outside site_selenacole)")


if __name__ == "__main__":
    main()
