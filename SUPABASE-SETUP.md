# Supabase setup for EXP Admin (staging only)

This repository change is a **database foundation**, not a connected backend. The admin page remains a fictional-data prototype. Do not use it to store real customer information or operate live appointments.

## Before creating anything

1. Create a dedicated Supabase project for development/staging, not a shared or production project.
2. Choose a region appropriate for the business and review data residency, privacy, and contractual requirements before storing any customer information.
3. Keep project credentials out of GitHub, HTML, browser JavaScript, screenshots, and chat. Never expose the Supabase service-role key in client code.
4. Configure Google OAuth only after setting up the correct OAuth consent screen, redirect URLs, and approved business identity. An OAuth login by itself does not authorize dashboard access.
5. Keep the public marketing website and its existing Google Calendar booking links unchanged.

## Migration

The initial migration is:

`supabase/migrations/202610110001_admin_foundation.sql`

Review it before applying it to a fresh staging project. Apply using the Supabase CLI migration workflow or SQL editor. It creates the initial staff, customer, appointment, payment, refund, follow-up, availability, notification, and audit tables, with row-level security enabled and no anonymous policies.

The migration has **not** been applied to any Supabase project. No project has been provisioned or connected by this repository change.

## First owner activation

New Auth users are deliberately added as inactive staff. The migration does not grant anyone the owner role automatically. After you verify the first intended owner account in Supabase Auth, an authorized project administrator must activate exactly that verified account through the Supabase SQL editor, substituting its actual Auth user UUID and email:

```sql
-- Run manually in the Supabase SQL editor only after verifying the Auth user.
-- Replace both placeholders. Do not run this with a guessed UUID or email.
update public.staff_profiles
set role = 'owner',
    is_active = true,
    activated_at = now(),
    updated_at = now()
where user_id = '<VERIFIED_AUTH_USER_UUID>'::uuid
  and lower(email) = lower('<VERIFIED_BUSINESS_EMAIL>');
```

Confirm exactly one row was updated. If zero rows were updated, stop and investigate. Do not make the initial owner active through an unauthenticated endpoint or a public signup flow. Keep a documented recovery owner/process under your control.

## Important security boundaries

- RLS is a second line of defense, not a substitute for server-side authorization.
- The current schema is a foundation. It does not yet implement Google OAuth configuration, server-side API routes, business-specific role permissions, atomic rescheduling, slot locking, Stripe webhooks, email sending, or secure customer self-service links.
- Browser roles have read-only access to customer and appointment fields, with private-note columns excluded. Customer, appointment, staff-role, refund, follow-up, availability, payment, notification, and audit mutations must go through trusted server operations so authorization, booking conflicts, pricing, payment state, and audit logging cannot be bypassed. Those server operations still need to be built and reviewed.
- Every refund must have an owner decision. The application service must validate the payment, refundable balance, actor, reason, and idempotency before calling Stripe.
- The exclusion constraint blocks overlapping active appointment times in the single-provider schedule. It does not validate business hours, 75-minute start cadence, the 15-minute payment hold, travel pricing, or Google Calendar consistency.
- Database owners/service-role clients can bypass RLS. Keep them server-side, use only for narrowly scoped trusted operations, and audit every sensitive action.
- The schema includes private-note fields. Minimize sensitive details, restrict them in the UI/API, and keep them out of logs, analytics, notifications, and search previews.
- This is not a compliance certification or a determination that the setup meets every healthcare/privacy obligation.

## Validation before any live data

- [ ] Apply the migration to a throwaway/staging project and inspect all policies.
- [ ] Verify anonymous requests cannot read any table.
- [ ] Verify a newly authenticated but inactive user cannot read/write operational tables.
- [ ] Verify an active staff account can access only the intended staff functions.
- [ ] Verify only the owner can activate accounts or approve refunds.
- [ ] Verify customer/appointment writes and all sensitive mutations are rejected from browser roles and only authorized server operations can perform them.
- [ ] Verify payment and notification state cannot be forged through the browser.
- [ ] Verify audit records are append-only through the intended server interface.
- [ ] Add automated tests for overlap conflicts, status/payment separation, completion outcomes, and refund authorization.
- [ ] Add server-side transactions for booking/rescheduling and a verified Stripe webhook before integration.
- [ ] Review privacy/security requirements and backups before introducing real records.

## Next implementation step

Build and test a small server-side authorization/data-access layer against a staging Supabase project, with fake records only. Do not add live integrations until the project and credentials are explicitly configured by the business owner.
