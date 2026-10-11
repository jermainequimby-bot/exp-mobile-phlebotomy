# EXP Admin sign-in gate: staging implementation notes

This document describes the next safe step for the staging dashboard. It does not enable Google sign-in, create an owner, or authorize any user.

## Current state

- `admin.html` remains a fictional-data-only prototype.
- Supabase Auth creates a `staff_profiles` row with `is_active = false`.
- Browser grants exclude private-note columns and operational writes.
- Google OAuth credentials are configured manually in the staging project, but the provider must remain disabled until the application has a reviewed auth flow.
- Do not add service-role credentials to client-side code, this repository, or chat.

## Self-access RPC contract

Add a database function named `public.get_my_staff_access()` that returns at most the signed-in user's own `user_id`, `email`, `display_name`, `role`, and `is_active` fields. It must filter by `auth.uid()`, use a fixed empty `search_path`, be `SECURITY DEFINER` only because it needs to read the protected profile table, revoke execute from `PUBLIC` and `anon`, and grant execute only to `authenticated`. It must not accept a user ID parameter, return other users, modify profiles, or grant operational-data access.

A result of no row, an inactive profile, a missing session, or an RPC error must all fail closed in the UI. This function is a status check, not the authorization boundary for future server APIs. Every trusted endpoint must independently validate the session and active role.

## App flow requirements

1. Unauthenticated visitors see a sign-in screen, not operational records.
2. Google sign-in uses the Supabase OAuth client and a strict redirect allowlist.
3. After OAuth return, retrieve the session and call `get_my_staff_access()`.
4. If there is no profile or `is_active = false`, show an access-denied screen and sign out or clear the local session; never render the dashboard.
5. Only an active, explicitly approved owner may pass the initial owner-only gate. Other active roles remain blocked until role-specific permissions are implemented and tested.
6. Sign-out clears the session and returns to the sign-in screen.
7. Session expiry, network failure, malformed responses, or RPC failure must fail closed.
8. Do not show private notes in overview cards, search previews, logs, or analytics.
9. Keep the preview banner and fictional data until server-backed reads and writes have been reviewed and tested.

## Owner bootstrap

Do not make an account owner merely because it signed in first. After the intended business Google account has signed in and its Auth user is visible, verify the exact email and UUID in Supabase Auth and the matching inactive profile. Then use the documented manual SQL bootstrap only after reviewing the target values. Confirm exactly one row was updated. If zero or multiple rows are affected, stop.

## Verification before enabling the provider

- Verify signed-out visitors cannot see dashboard data.
- Verify an authenticated inactive user receives access denied.
- Verify the own-profile RPC cannot return another user's profile.
- Verify active non-owner roles remain denied during owner-only rollout.
- Verify sign-out, expired sessions, RPC failures, and redirect failures fail closed.
- Verify direct browser requests cannot write operational tables or read private-note columns.
- Keep provider disabled until these checks are implemented and reviewed.

This checklist is implementation guidance, not evidence that the flow is already implemented or tested.
