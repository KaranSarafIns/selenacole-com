#!/usr/bin/env python3
"""Apply one SQL migration file to the site_selenacole schema via the
Supabase Management API. Usage: run-migration.py path/to/migration.sql
Idempotent migrations only (IF NOT EXISTS / guards). Never prints credentials.
Verifies the schema is otherwise untouched via a table-list snapshot diff."""
from __future__ import annotations

import json
import sys
import urllib.request
import urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response  # noqa: E402

BASE = "https://api.supabase.com"
PROJECT_REF = "jqestqdxgouytixpxcso"
SCHEMA = "site_selenacole"


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


def tables_in(schema):
    rows = query(f"SELECT table_name FROM information_schema.tables "
                 f"WHERE table_schema = '{schema}' ORDER BY table_name", read_only=True)
    out = []
    for r in rows:
        out.append(r["table_name"] if isinstance(r, dict) else r[0])
    return out


def main():
    path = sys.argv[1]
    with open(path) as f:
        sql = f.read()
    sql = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("--"))
    before = tables_in(SCHEMA)
    n = 0
    for stmt in [s.strip() for s in sql.split(";") if s.strip()]:
        query(stmt)
        n += 1
    after = tables_in(SCHEMA)
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    print(f"migration {path}: {n} statements ok")
    print(f"tables before={len(before)} after={len(after)} added={added} removed={removed}")
    if removed:
        raise SystemExit("migration removed tables — aborting loudly")


if __name__ == "__main__":
    main()
