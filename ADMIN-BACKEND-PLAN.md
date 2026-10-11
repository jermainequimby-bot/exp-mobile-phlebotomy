# EXP Admin Dashboard: Backend Build Plan

## Purpose

Turn the static admin preview into a private operational dashboard without exposing patient/customer information, payment credentials, or booking controls. The public marketing site and its existing booking links must remain unchanged.

## Current state

- `admin.html` is a UI prototype with fictional sample records.
- GitHub Actions smoke checks validate basic HTML structure, inline JavaScript syntax, and preview-only safety labels.
- Vercel deploys a preview from the feature branch.
- No real authentication, database, Google Calendar integration, email delivery, Stripe processing, or authorization exists yet.
- Never enter real customer data or use this prototype to operate appointments.

## Recommended architecture for review

- **Web app:** Keep the existing Vercel deployment path; move admin into a dedicated route or app only after confirming routing and deployment behavior.
- **Backend/database:** Use a managed PostgreSQL service such as Supabase, with schema migrations and row-level security. All authorization checks must also be enforced server-side.
- **Authentication:** Google sign-in restricted to explicitly approved business accounts. A visible UI gate alone is not security.
- **Secrets:** Store provider credentials only in server-side environment variables. Never commit secrets or expose service-role credentials to browser code.
- **Payments:** Stripe server-side checkout/webhook verification; idempotent event handling. Browser redirects are not proof of payment.
- **Scheduling:** Google Calendar integration on the server. Secure a replacement slot before releasing the old one; use locking/transactions to prevent double booking.
- **Email:** Server-side email provider, bounded retries, delivery state tracking, and a Needs Attention item for unresolved failures.
- **Audit:** Append-only records for access changes, bookings, cancellations, reschedules, completion, availability changes, and refund decisions/actions.

The service choices above are recommendations, not configured integrations. Confirm the chosen backend and providers before provisioning accounts or connecting live services.

## Build sequence

### Phase 1: Strengthen the preview
- Keep fictional data and the preview banner.
- Add automated browser tests for navigation, search/filter, appointment completion validation, follow-up creation/completion, issue resolution, and payment/refund preview.
- Keep the dashboard isolated from production routes and data.

### Phase 2: Database and identity
- Define migrations for users/roles, customers, appointments, payment records, follow-up tasks, availability blocks, notifications, audit events, and refund requests.
- Add server-side authorization and least-privilege role checks.
- Test unauthorised access, session expiry, revoked access, and private-note visibility.
- Do not import real customer data until security review is complete.

### Phase 3: Appointment and availability service
- Enforce the Saturday/Sunday schedule and configured slot spacing on the server.
- Protect booked appointments from conflicting availability blocks.
- Make appointment status separate from payment status.
- Never mark No-show automatically.
- Use atomic operations to prevent double bookings and unsafe rescheduling.

### Phase 4: Payments and communications
- Verify Stripe webhook signatures and payment state server-side.
- Implement the 15-minute payment retry window without prematurely releasing a slot.
- Keep refunds separate from cancellations and require explicit owner approval for every refund.
- Add customer email confirmations/reminders only after provider configuration and policy links are ready.
- Track provider acceptance separately from delivery confirmation; retry temporary failures and surface unresolved failures.

### Phase 5: Controlled launch
- Run integration, access-control, booking-race, payment, email-failure, cancellation, refund, backup/restore, and audit-history tests with test accounts.
- Review privacy, security, and applicable healthcare/data-handling obligations before production use.
- Enable real bookings only after all critical checks pass and credentials are configured.

## Business rules to preserve

- Business timezone: America/Chicago.
- Availability: Saturday and Sunday, 8:00 AM–6:00 PM; appointments start every 75 minutes; planned visit duration 45 minutes.
- Service pricing and travel-fee rules must be preserved from the approved business configuration and not silently changed in the public site.
- Customer reminders: 24 hours and 2 hours before appointments, email first.
- Payment retry window: 15 minutes.
- Every refund requires explicit owner approval.
- A cancelled slot reopens only after cancellation is finalized.
- A reschedule secures the new slot before releasing the old one.
- Follow-up tasks remain visible until completed or cancelled; dismissing an alert does not resolve the underlying issue.
- Keep private notes out of overview cards and search previews.

## Launch safety checklist

- [ ] Backend provider and region selected.
- [ ] Business owner account and recovery process verified.
- [ ] Server-side authorization and database policies reviewed.
- [ ] Secret storage configured outside the repository.
- [ ] Audit log and backup/restore procedure tested.
- [ ] Stripe test-mode events and webhook retries tested.
- [ ] Calendar conflict and concurrent booking tests passed.
- [ ] Email templates, cancellation policy, and secure manage-booking flow reviewed.
- [ ] Accessibility and mobile browser tests passed.
- [ ] Security/privacy review completed before real records are introduced.
