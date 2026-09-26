# Cloudflare Pages Deployment Guide

## 1) Supabase setup
1. Create a Supabase project.
2. Enable Auth provider: Email.
3. Ensure **Auth → URL Configuration** is set:
   - Site URL (your app URL)
   - Redirect URL includes `/auth` route
4. Enable Auth providers as needed (e.g., Google, GitHub) for SSO login.
5. Run your project schema SQL (tables) and then run:
   - `supabase/001_auth_profiles_bootstrap.sql`
   - `supabase/002_trip_contact_requests_chat.sql`
   - `supabase/003_airport_codes_public_search_and_notifications.sql`
   - `supabase/004_signup_atomic_profile_subscription.sql`
   - `supabase/005_harden_signup_trigger_runtime.sql`

This adds:
- RLS policies for `profiles`
- trigger `on_auth_user_created` to auto-create `profiles` row from `auth.users`

## 2) Configure Angular environment
Update both environment files:
- `src/environments/environment.ts` (local/dev)
- `src/environments/environment.prod.ts` (production)

Set:
- `supabaseUrl`
- `supabaseAnonKey`

If these remain placeholders, auth calls may fail in the browser with `Failed to fetch` and no user/profile row will be created.

## 2.1) Deploy account deletion edge function (recommended)
This app can call an edge function named `delete-auth-user` for secure auth-user deletion.

Required env vars for the function:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 3) Build locally
```bash
npm install
npm run build
```
Build output is under `dist/travel-companion/browser`.

## 4) Deploy to Cloudflare Pages (Git integration)
1. Push this repository to GitHub/GitLab.
2. In Cloudflare Dashboard: **Pages** → **Create project**.
3. Connect your repo.
4. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist/travel-companion/browser`
5. Deploy.

## 5) SPA routing support
This repo includes `src/_redirects` and `angular.json` assets config so Cloudflare serves `index.html` for client routes.

## 6) Optional Wrangler deployment
```bash
npm run build
npx wrangler pages deploy dist/travel-companion/browser
```


## 7) Optional match-notification edge function
After trip save, frontend may invoke `trip-match-notify` as a non-blocking call.
If not deployed, trip save still succeeds and UI shows a warning only.

## 8) Premium upgrade notifications

Apply `supabase/012_auto_match_notifications.sql`, then
`supabase/013_premium_upgrade_match_notifications.sql` after the existing schema
migrations. These in-app notifications do not require the optional email edge
function above. Deploying Angular alone does not apply database migrations.

When trusted backend code inserts an active paid subscription, upgrades FREE to
an active paid plan, or reactivates an inactive paid subscription, a database
trigger finds existing matching trips for that user's saved itineraries. It uses
the same route and optional connection rules as new-trip alerts, with overlapping
dates today or later. No saved itinerary means there are no criteria to match.
Existing notifications, including their read state, are preserved on retries.
Normal active-to-active subscription updates do not repeat the scan.

Payment activation must be written only after payment verification by a trusted
backend using the Supabase service role. Migration 013 removes browser clients'
ability to change subscription plans and limits self-service inserts to FREE.
Never put a service-role key in Angular. There is no payment integration in this
repository yet; the trigger runs whenever that backend updates `subscriptions`.

The backfill runs inside the subscription transaction. Ordinary notification
errors are caught and logged as PostgreSQL warnings so activation still commits;
this is not a background job, and matching adds database execution time to the
activation. The existing fire-and-forget trip-save notification path is unchanged.
There is no automatic retry worker. After a warning, trusted backend code can
retry for the affected user using:

```sql
select public.backfill_premium_match_notifications('<user-uuid>'::uuid);
```

An authenticated client may also retry only its own matches via the no-argument
RPC `create_premium_backfill_notifications`. Both paths recheck the subscription
and use the existing unique AUTO_MATCH index to prevent duplicate alerts.
The same trusted-backend function can populate matches for subscribers whose
activation happened before this migration. Applying the migration itself does
not scan all existing subscribers.

Created rows appear through the existing notification badge/realtime channel and
Notifications page. The page also retrieves them on navigation or refresh, so
the user does not have to be online at activation time.

Run local PostgreSQL regression tests with `npm run test:notifications`. The
tests use an isolated PGlite database, execute the notification migrations, and
cover activation, matching, duplicate prevention, access rules, and failure
isolation without accessing production accounts.
