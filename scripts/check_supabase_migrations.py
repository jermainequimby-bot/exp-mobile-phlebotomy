#!/usr/bin/env python3
"""Static checks for EXP Supabase migrations; does not replace applying them to PostgreSQL."""
from pathlib import Path
import re
from pglast import parse_sql

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
if len(MIGRATIONS) < 2:
    raise SystemExit("Expected foundation and security-hardening migrations")

for migration in MIGRATIONS:
    source = migration.read_text(encoding="utf-8")
    try:
        parse_sql(source)
    except Exception as exc:
        raise SystemExit(f"SQL parse failed for {migration.name}: {exc}") from exc
    if not re.search(r"(?im)^begin\s*;", source) or not re.search(r"(?im)^commit\s*;", source):
        raise SystemExit(f"{migration.name} must wrap changes in a transaction")

foundation = next(p for p in MIGRATIONS if p.name.endswith("admin_foundation.sql")).read_text(encoding="utf-8").lower()
hardening = next(p for p in MIGRATIONS if p.name.endswith("security_hardening.sql")).read_text(encoding="utf-8").lower()

tables = [
    "staff_profiles", "customers", "appointments", "payment_records",
    "refund_requests", "follow_up_tasks", "availability_blocks",
    "notification_events", "audit_events",
]
for table in tables:
    if f"alter table public.{table} enable row level security" not in foundation:
        raise SystemExit(f"RLS is not enabled for {table}")

for token in ("appointments_no_overlapping_active_bookings", "completion_has_outcome",
              "create policy refund_requests_owner_update", "create policy refund_requests_owner_insert"):
    if token not in foundation:
        raise SystemExit(f"Missing expected database safety contract: {token}")

if "revoke all on table" not in hardening:
    raise SystemExit("Explicit browser-role privilege reset is missing")
if not all(x in hardening for x in ("grant select (", "public.customers to authenticated", "public.appointments to authenticated")):
    raise SystemExit("Explicit column-level browser grants are missing")
if "private_notes" in re.search(r"grant select \((.*?)\) on public\.customers", hardening, re.S).group(1):
    raise SystemExit("Customer private_notes must not be granted to browser roles")
if "private_notes" in re.search(r"grant select \((.*?)\) on public\.appointments", hardening, re.S).group(1):
    raise SystemExit("Appointment private_notes must not be granted to browser roles")
for token in ("audit_events_no_update", "audit_events_no_delete", "reject_audit_mutation"):
    if token not in hardening:
        raise SystemExit(f"Missing append-only audit protection: {token}")

# All sensitive writes must use trusted server operations, not browser table grants.
for table in ("customers", "appointments", "refund_requests", "follow_up_tasks", "availability_blocks"):
    if re.search(rf"grant\s+(?:insert|update|delete|all)[^;]*on public\.{table}\s+to authenticated", hardening, re.S):
        raise SystemExit(f"Browser write grant found for {table}; mutations must be server-side")
if "payment_status, created_by" in hardening:
    raise SystemExit("Browser must never be granted a write path for payment status")

# Payment and appointment lifecycle must remain separate columns/types.
if "payment_status public.payment_status" not in foundation or "status public.appointment_status" not in foundation:
    raise SystemExit("Appointment and payment state must remain separate")
if re.search(r"sk_live_[a-z0-9]+|service_role_key\s*=", "".join(p.read_text(encoding="utf-8") for p in MIGRATIONS), re.I):
    raise SystemExit("Possible secret-like credential found in migration source")

print(f"PASS: parsed {len(MIGRATIONS)} migrations and checked RLS, booking overlap, private-note grants, refunds, and append-only audit.")
print("NOTE: static checks only; apply to an isolated staging database and test effective privileges before any real data.")
