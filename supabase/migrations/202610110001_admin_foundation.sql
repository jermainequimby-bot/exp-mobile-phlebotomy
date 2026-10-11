-- EXP Mobile Phlebotomy admin foundation
-- Supabase/PostgreSQL migration. No production data is included.
-- Apply only to a dedicated Supabase project after reviewing the security notes.

begin;

create extension if not exists pgcrypto;

create type public.staff_role as enum ('owner', 'admin', 'staff');
create type public.appointment_status as enum (
  'awaiting_payment', 'confirmed', 'in_progress', 'completed',
  'follow_up_needed', 'canceled', 'no_show'
);
create type public.payment_status as enum (
  'pending', 'paid', 'failed', 'partially_refunded', 'refunded'
);
create type public.collection_outcome as enum ('successful', 'partial', 'unsuccessful');
create type public.follow_up_status as enum ('open', 'in_progress', 'completed', 'canceled');
create type public.refund_status as enum ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed');

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  email text not null,
  display_name text,
  role public.staff_role not null default 'staff',
  is_active boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_email_nonempty check (length(trim(email)) > 3)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  private_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint customer_name_nonempty check (length(trim(full_name)) > 0)
);

create index customers_name_idx on public.customers (lower(full_name));
create index customers_email_idx on public.customers (lower(email)) where email is not null;
create index customers_phone_idx on public.customers (phone) where phone is not null;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  service_code text not null,
  service_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Chicago',
  status public.appointment_status not null default 'awaiting_payment',
  quoted_amount_cents integer not null check (quoted_amount_cents >= 0),
  currency text not null default 'usd' check (currency = lower(currency)),
  payment_status public.payment_status not null default 'pending',
  collection_outcome public.collection_outcome,
  equipment_issue boolean not null default false,
  equipment_issue_notes text,
  follow_up_needed boolean not null default false,
  private_notes text,
  calendar_event_id text,
  cancellation_finalized_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_time_order check (ends_at > starts_at),
  constraint appointment_min_duration check (ends_at - starts_at <= interval '12 hours'),
  constraint completion_has_outcome check (
    status not in ('completed', 'follow_up_needed') or collection_outcome is not null
  ),
  constraint no_automatic_noshow_enforcement check (status <> 'no_show' or completed_at is null)
);

create index appointments_starts_at_idx on public.appointments (starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_status_idx on public.appointments (status, starts_at);

-- Prevent overlapping live bookings for the same appointment schedule.
-- A service layer should still validate opening hours, slot cadence, and business-specific rules.
create extension if not exists btree_gist;
alter table public.appointments
  add constraint appointments_no_overlapping_active_bookings
  exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status not in ('canceled', 'no_show'));

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_payment_intent_id text unique,
  provider_checkout_session_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status public.payment_status not null default 'pending',
  verified_at timestamptz,
  last_provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_records_appointment_idx on public.payment_records (appointment_id, created_at desc);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  payment_record_id uuid not null references public.payment_records(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  requested_amount_cents integer not null check (requested_amount_cents > 0),
  currency text not null default 'usd',
  reason text not null,
  policy_summary text,
  status public.refund_status not null default 'requested',
  requested_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  provider_refund_id text unique,
  provider_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_review_is_owner check (
    reviewed_by is null or reviewed_by <> requested_by
  )
);

create table public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  description text,
  due_at timestamptz not null,
  reminder_at timestamptz,
  status public.follow_up_status not null default 'open',
  private_notes text,
  created_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  outcome_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index follow_up_due_idx on public.follow_up_tasks (status, due_at);

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint availability_block_time_order check (ends_at > starts_at)
);
create index availability_blocks_range_idx on public.availability_blocks using gist (tstzrange(starts_at, ends_at, '[)'));

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete restrict,
  channel text not null default 'email' check (channel in ('email')),
  notification_type text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'canceled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  last_error text,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_retry_idx on public.notification_events (status, next_attempt_at);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events (created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);

-- New sign-ins are deliberately inactive until the owner approves them.
create or replace function public.bootstrap_staff_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_profiles (user_id, email, display_name, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    false
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.bootstrap_staff_profile();

-- Security-definer helpers avoid recursive RLS checks on staff_profiles.
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid()) and p.is_active = true
  );
$$;

create or replace function public.has_staff_role(allowed public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles p
    where p.user_id = (select auth.uid())
      and p.is_active = true
      and p.role = any(allowed)
  );
$$;

revoke all on function public.bootstrap_staff_profile() from public, anon, authenticated;
revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.has_staff_role(public.staff_role[]) from public, anon;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.has_staff_role(public.staff_role[]) to authenticated;

alter table public.staff_profiles enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.payment_records enable row level security;
alter table public.refund_requests enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.notification_events enable row level security;
alter table public.audit_events enable row level security;

-- No anonymous policies. Staff access requires an explicitly activated account.
create policy staff_profiles_read_active on public.staff_profiles
  for select to authenticated using (public.is_active_staff());
create policy staff_profiles_owner_manage on public.staff_profiles
  for all to authenticated
  using (public.has_staff_role(array['owner']::public.staff_role[]))
  with check (public.has_staff_role(array['owner']::public.staff_role[]));

create policy customers_staff_access on public.customers
  for all to authenticated using (public.is_active_staff())
  with check (public.is_active_staff());
create policy appointments_staff_access on public.appointments
  for all to authenticated using (public.is_active_staff())
  with check (public.is_active_staff());
create policy payment_records_staff_read on public.payment_records
  for select to authenticated using (public.is_active_staff());
create policy refund_requests_staff_read on public.refund_requests
  for select to authenticated using (public.is_active_staff());
create policy refund_requests_owner_insert on public.refund_requests
  for insert to authenticated
  with check (public.has_staff_role(array['owner']::public.staff_role[]));
create policy refund_requests_owner_update on public.refund_requests
  for update to authenticated
  using (public.has_staff_role(array['owner']::public.staff_role[]))
  with check (public.has_staff_role(array['owner']::public.staff_role[]));
create policy follow_up_tasks_staff_access on public.follow_up_tasks
  for all to authenticated using (public.is_active_staff())
  with check (public.is_active_staff());
create policy availability_blocks_staff_access on public.availability_blocks
  for all to authenticated using (public.is_active_staff())
  with check (public.is_active_staff());
create policy notification_events_staff_read on public.notification_events
  for select to authenticated using (public.is_active_staff());
create policy audit_events_staff_read on public.audit_events
  for select to authenticated using (public.is_active_staff());
-- Deliberately no UPDATE/DELETE/INSERT policies for audit_events: write only through trusted server code.

-- Prevent direct browser writes to provider-controlled payment/notification/audit state.
revoke insert, update, delete on public.payment_records from anon, authenticated;
revoke insert, update, delete on public.notification_events from anon, authenticated;
revoke insert, update, delete on public.audit_events from anon, authenticated;
grant select on public.payment_records, public.notification_events, public.audit_events to authenticated;

commit;
