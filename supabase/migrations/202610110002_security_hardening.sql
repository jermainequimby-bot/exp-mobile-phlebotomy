-- EXP admin security hardening: explicit grants, private-note isolation, append-only audit.
-- Review and apply after 202610110001_admin_foundation.sql on a staging project.

begin;

-- Do not rely on project-wide default privileges for browser-facing access.
revoke all on table
  public.staff_profiles,
  public.customers,
  public.appointments,
  public.payment_records,
  public.refund_requests,
  public.follow_up_tasks,
  public.availability_blocks,
  public.notification_events,
  public.audit_events
from anon, authenticated;

-- Staff identity and operational records. Private-note columns are intentionally
-- excluded from browser roles until a separately authorized server endpoint exists.
grant select (user_id, email, display_name, role, is_active, invited_by, activated_at, created_at, updated_at)
  on public.staff_profiles to authenticated;
grant update (role, is_active, activated_at, updated_at)
  on public.staff_profiles to authenticated;

grant select (
  id, full_name, email, phone, address_line1, address_line2, city, region,
  postal_code, created_by, created_at, updated_at, archived_at
) on public.customers to authenticated;
grant insert (
  full_name, email, phone, address_line1, address_line2, city, region,
  postal_code, created_by
) on public.customers to authenticated;
grant update (
  full_name, email, phone, address_line1, address_line2, city, region,
  postal_code, archived_at, updated_at
) on public.customers to authenticated;

grant select (
  id, customer_id, service_code, service_name, starts_at, ends_at, timezone,
  status, quoted_amount_cents, currency, payment_status, collection_outcome,
  equipment_issue, equipment_issue_notes, follow_up_needed, calendar_event_id,
  cancellation_finalized_at, completed_at, created_by, created_at, updated_at
) on public.appointments to authenticated;
grant insert (
  customer_id, service_code, service_name, starts_at, ends_at, timezone,
  status, quoted_amount_cents, currency, payment_status, created_by
) on public.appointments to authenticated;
grant update (
  service_code, service_name, starts_at, ends_at, timezone, status,
  collection_outcome, equipment_issue, equipment_issue_notes, follow_up_needed,
  cancellation_finalized_at, completed_at, updated_at
) on public.appointments to authenticated;

grant select on public.payment_records to authenticated;
grant select on public.refund_requests to authenticated;
grant insert, update on public.refund_requests to authenticated;
grant select, insert, update on public.follow_up_tasks to authenticated;
grant select, insert, update, delete on public.availability_blocks to authenticated;
grant select on public.notification_events to authenticated;
grant select on public.audit_events to authenticated;

-- Refund review remains owner-only by RLS. Approval workflow, refundable-balance
-- validation and Stripe calls must be implemented in trusted server code.
-- A request can be reviewed by its requesting owner; the owner remains accountable.
alter table public.refund_requests
  drop constraint if exists refund_review_is_owner;

-- Make audit history append-only even for ordinary privileged application paths.
create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

revoke all on function public.reject_audit_mutation() from public, anon, authenticated;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.reject_audit_mutation();
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.reject_audit_mutation();

commit;
