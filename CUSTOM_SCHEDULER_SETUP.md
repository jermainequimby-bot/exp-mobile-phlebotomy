# EXP Custom Scheduler

This branch replaces customer-facing Google Calendar booking with an EXP-owned scheduler.

## Flow

1. Customer chooses service.
2. Customer enters service address.
3. Google Routes API calculates driving distance and the exact EXP price.
4. Customer chooses a weekend appointment slot.
5. The selected slot is held in Neon for 35 minutes.
6. Stripe Checkout handles payment and expires after 30 minutes.
7. Stripe webhook marks the appointment paid.
8. The success page reads the confirmed appointment from Neon.

## Current schedule

The initial database seed is:

- Saturday: 8:30 AM–6:00 PM
- Sunday: 8:30 AM–6:00 PM
- 45-minute appointments
- Last standard start: 5:15 PM
- Time zone: America/Chicago

After-hours availability is supported by the schema but intentionally not activated until the exact window is confirmed.

## Database

Run `db/schema.sql` once in the Neon SQL Editor.

The application uses the Vercel Preview environment's `DATABASE_URL`.

## Stripe

The existing Stripe webhook endpoint remains the source of truth for payment confirmation.

The webhook code also handles `checkout.session.expired` so expired holds can be released immediately when that event is enabled on the Stripe destination. The current Stripe destination should be updated to listen for:

- `checkout.session.completed`
- `checkout.session.expired`

## Security notes

- Stripe secret keys and database credentials remain server-side environment variables.
- The booking page never receives database credentials.
- Appointment addresses and contact information are stored in the private database, not in public HTML.
- Laboratory results and medical records are not stored by this booking system.
- The database uses a unique date/start-time constraint so two customers cannot successfully hold the same slot at the same time.

## Next build stages

1. Run the schema in Neon.
2. Deploy this branch to Vercel Preview.
3. Test availability.
4. Test a sandbox booking and Stripe payment.
5. Confirm the webhook changes the appointment to paid.
6. Add the exact after-hours schedule.
7. Build the private EXP admin calendar.
8. Add confirmation email and cancellation/rescheduling tools.
9. Only after all tests pass, retire the Google Calendar booking pages.
