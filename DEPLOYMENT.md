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

If migration 013 failed with `column "plan_code" does not exist`, rerun the
updated **012 first, then 013**, in the SQL editor. Both scripts are repeatable
and preserve existing subscription and notification rows. Rerunning 012 also
repairs the new-trip notification RPC; rerunning only 013 fixes upgrade matching
but leaves an older new-trip RPC incompatible with `plan`.

Both `subscriptions.plan` (existing databases) and `subscriptions.plan_code`
(migration 004's new-table schema) are supported. No columns are renamed or added,
and existing plan values and billing-period fields are not rewritten. If both
plan columns exist, `plan` is authoritative; NULL or blank plans do not qualify
for Premium. Billing-period eligibility rules are unchanged.

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
isolation without accessing production accounts. The same tests run against
both the `plan_code` schema and the reported `plan` schema with its UUID primary
key and billing-period columns. They also verify new-trip notifications and
that rerunning migration 013 preserves existing subscription records.

## 9) Subscription page and demo checkout

Apply `supabase/014_subscription_checkout.sql` after the updated migrations 012
and 013, then deploy Angular. The navbar's Subscription link opens
`/subscription`. Users choose Premium, proceed to
`/subscription/checkout/:id`, and click **Complete demo payment**. No card
details are collected, no money is charged, and no renewal is scheduled.
Demo Premium has no automatic expiration.

The checkout is persisted server-side and belongs to the signed-in user. It
expires after 30 minutes; users can cancel before completion. Starting checkout
does not activate Premium. Completion updates or creates the subscription and
marks the checkout completed in one transaction. Retrying a completed checkout
returns its existing result. Activation invokes migration 013's existing match
notification trigger. Both `plan` and `plan_code` schemas are supported.

Migration 014 deliberately enables the dummy gateway. To turn it off, run this
as a database administrator or trusted backend:

```sql
update public.subscription_billing_settings set mock_enabled = false where id;
```

This disables both new demo checkouts and completion of pending demo checkouts.
It does not revoke Premium already granted by the demo.

### Real gateway integration

The `PAYMENT_GATEWAY` injection token separates page behavior from the
`MockPaymentGateway` adapter. A real adapter should request a hosted checkout
from a trusted backend and redirect the user to the payment provider.

The backend must set the plan, price, currency, billing period, provider, and
checkout ownership. A webhook must verify the provider signature, successful
payment, expected amount/currency, and checkout reference before calling the
service-role-only `fulfill_subscription_checkout` function. Extend that
function's demo entitlement assignment for real paid billing periods, renewal,
cancellation and refunds. Browser redirects are not payment confirmation.
The existing unique provider reference and completed-checkout handling support
idempotent settlement.

Disable the mock gateway before enabling real payments; never expose service-role
keys or permit browsers to call fulfillment directly. Real provider code and
recurring billing are not included in this demo implementation.

### Language Dropdown Configuration

Edit `src/app/config/languages.ts` to configure the Languages Known choices for
Post Trip and Edit Itinerary, then rebuild and deploy Angular. The dropdown
supports up to 20 selections and stores the selected names in the existing
`languages_known` array. No additional SQL migration is needed after 018.
Keep existing names stable; removing a choice prevents new trips from selecting
it, but existing trips retain it as a selectable value during editing.

### Personal Activity and Anonymous Trips

Apply `supabase/019_personal_activity_anonymous_trips.sql` after 018 and before
deploying the updated Angular app. It is safe to rerun. No production SQL is
executed by the application or the test scripts.

Every signed-in account has a My Activity page. Its RPC derives the user from
the current session and returns only actions performed by or affecting that
account. The response excludes other users' identities and private audit details
such as moderation reasons. The page includes recorded button/field actions,
navigation, data request outcomes, account changes and notification events.
History uses the existing 017 audit collection: it cannot reconstruct earlier
actions or guarantee browser delivery during offline periods or blocked telemetry.
Fixed control labels make new events readable without collecting arbitrary UI
text, input values, passwords, tokens or notification bodies. Older positional
button events are described generically because their original labels were not stored.

Post anonymously is optional and defaults to off, including existing trips.
The public search view returns Anonymous and masks the owner ID for other users;
raw anonymous-trip reads are restricted to the owner and request participants.
Anonymous posting hides identity while browsing, not during requests, chats,
approved contact sharing or administrator moderation. User-entered notes and
contact details are not anonymized. The checkbox can be changed when editing.
The server resolves trip ownership when creating requests and serializes requests
for the same itinerary to avoid duplicate active requests. Contact approval rules
remain in force. Deploy this migration before the frontend's new request RPC.

### Travel Community

Apply `supabase/020_travel_community.sql` after 019 and before deploying the
Community frontend. It adds four RLS-protected tables and bounded read/reaction
RPCs. No Realtime or authentication configuration changes are required.
See `docs/travel-community.md` for permissions, moderation, trip-data privacy,
pagination, deployment steps and verification commands.

### Verification

`npm run test:notifications` covers checkout creation/completion, missing
subscription records, idempotency, ownership, protected fulfillment, cancellation,
expiry, disabling the mock provider, transaction rollback and activation-triggered
notifications against both subscription schemas.

## 10) Optional destination removal and navigation

Deploy the updated Angular app, then apply
`supabase/015_remove_optional_destination.sql` after the earlier migrations.
Reload any older open app tabs after deployment so they stop sending the removed
field. This migration permanently removes the optional free-text
`itineraries.destination` column and its saved values. Destination airport codes,
flight legs, trip dates and contact details remain intact.

Migration 015 rebuilds `public_itinerary_search` without the removed field and
restores public read grants. It uses a transaction and does not use CASCADE:
unknown downstream database dependencies cause it to fail without deleting those
objects. Do not reapply older view migrations (002, 003, 007 or 011) after 015;
their historical view definitions still reference the removed column.

Chat now accepts phone numbers. Existing email, external-messenger and payment
keyword restrictions are unchanged. No database phone-blocking rule is defined
in the repository.

Navigation shows the maximum prefix of links that fits alongside the brand.
Remaining links and logout appear under More; active state and unread indicators
are retained. Links are remeasured after resizing, font loading or account/badge
changes. Escape, outside clicks and navigation close the overflow panel.

Verification:
- `npm run test:destination`: isolated PostgreSQL migration tests.
- `npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/services/chat.service.spec.ts`: phone-message tests.
- Start the dev server at `http://127.0.0.1:4200`, then run
  `node scripts/verify-trip-chat-navigation.mjs` with Playwright available.
  Alternatively set `PLAYWRIGHT_MODULE` to its installed package directory.
  The script uses headless Edge, synthetic sessions and intercepted APIs; it does
  not access production data. Screenshots are written under `.artifacts/`.

## 11) Fix publishing after destination removal

If Publish Itinerary reports `record "new" has no field "destination"`, apply
`supabase/016_remove_legacy_destination_sync.sql` in the Supabase SQL editor.
No Angular redeployment is required for this database repair.

The original database had `trg_sync_itineraries_destination_columns`, calling
`sync_itineraries_destination_columns()` to mirror the removed free-text
`destination` column and `destination_airport`. PL/pgSQL record-field references
are not tracked as column-drop dependencies, so that trigger survived the column
removal and then failed on insert/update.

Migration 016 removes only that obsolete trigger and its function. It preserves
`itineraries_validate_dates`, both destination airport fields, and existing trip
data; it does not restore the removed optional field. It is repeatable and uses
no CASCADE. The updated 015 also retires this known trigger before dropping the
column on new installations and checks for other direct NEW/OLD destination
references in attached trigger functions.

For an unexpected trigger dependency, use the read-only
`supabase/diagnostics/itinerary_triggers.sql` to inspect definitions before
changing them. The preflight is a targeted check for direct record references,
not a full analysis of dynamic SQL or nested helper functions.

## 12) Admin console and activity history

### Deploy and grant access

1. Back up the database and test on a staging Supabase project first. Apply
   `supabase/017_admin_activity.sql` as `postgres` in the SQL Editor after 001-016.
   The migration expects the existing application tables, including notifications
   and subscription checkouts. It is transactional and repeatable.
2. In `supabase/admin/grant_admin.sql`, replace the placeholder email with the
   email of an existing account. Run that script as `postgres`. A missing or
   ambiguous account fails; no account is silently created. Role grants and
   revocations are audited. SQL-operator changes have a null actor (System / SQL).
3. Apply `supabase/018_itinerary_languages_known.sql` if this release includes
   itinerary-language capture. It adds `itineraries.languages_known` and refreshes
   `public_itinerary_search`; run it before deploying the Angular code that writes
   the new field.
4. Deploy Angular. The Admin link appears for admins; open `/admin` after signing
   in. Access is rechecked on foreground return. To revoke immediately at the
   server, delete that UUID from `public.app_admins` using a trusted SQL session.

The role is not a profile field, user-editable metadata, or cached JWT claim.
Normal accounts cannot grant themselves access. Every admin RPC verifies the
current database role and auth identity. No service-role key is sent to Angular.
The route guard and hidden menu are usability features, not authorization.
Admin/audit tables have RLS and no browser table privileges; access is through
the explicitly granted, permission-checked functions only. Helpers are not
callable by `anon` or `authenticated`; definer functions use an empty search path.

### Console and moderation

- Overview: accounts/new accounts/admins/Premium, posts/upcoming/new posts,
  requests by key status, conversations/messages, notification totals/unread,
  completed **demo** checkouts, recent active actors/events/reported API failures.
  Demo checkouts are not revenue. Premium uses the same entitlement helper and
  ACTIVE status as the existing notification/checkout code (not a new billing rule).
- Users: searchable, paginated identity/access/post counts and sign-in dates.
- Posts: searchable, paginated routes/dates/owners/request counts.
- Activity: paginated history, action/record search, source, actor or recipient
  UUID, and inclusive UTC date-range filters. Displayed timestamps use local time.
  Active-user metrics count distinct audit actors, including subsequently deleted
  accounts; they are not concurrent-session counts.
- User Activity: a readable activity view scoped to one user by UUID, or searchable
  by name/email/user ID, including browser actions and notifications.
- Account/post deletion requires typing DELETE and a 3-500 character reason.
  Do not put secrets in moderation reasons. Self-deletion and deletion of any
  current admin are blocked; revoke the role in SQL before another admin deletes
  that account. Ordinary self-service account deletion is unchanged.
- Deletion removes the auth identity (accounts only), owned posts, related
  requests/chat threads/messages/notifications, contact details, legs, subscription
  and checkout records as applicable. The SQL operation and audit entry are one
  transaction. Unknown foreign-key dependencies roll everything back and produce
  a visible error; no CASCADE schema changes are used.
- Accounts owning Storage files are blocked with an actionable error. Use the
  Supabase Storage API/dashboard to remove or transfer files, then retry. Never
  delete storage metadata directly. Files, payment-provider subscriptions and
  other external resources are not deleted by this console.
- Supabase permits direct auth-user deletion, but an already issued JWT may
  remain valid until expiry; see [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).
  Auth sessions/refresh records follow Supabase's existing FK cascades. Admin
  authorization and client-activity ingestion additionally require the user to
  still exist. This migration does not rewrite unrelated application RLS, custom
  external services or invalidate every cached token on those services.

### Audit coverage and privacy

Authoritative `database` events record successful INSERT/UPDATE/DELETE operations
on profiles, itineraries, legs, contacts, requests, threads, messages,
subscriptions, checkouts, notifications and admin roles, plus auth-user lifecycle
and auth session creation/deletion. No-op updates are skipped. These writes are
transactional: if auditing fails, the associated mutation fails too. Existing
best-effort notification generation remains non-blocking to itinerary saving.
`admin` records cover console reads and successful deletions with their reasons.
An unknown schema dependency or failed transaction never leaves a false
successful-delete audit entry.

Notification inserts identify the recipient, type and notification ID; updates
record read-state changes. Request/message badges are derived from their tables,
so `notification.available` records badge eligibility, **not delivery**. The app
does not implement email/push receipts. Notifications generated by a background
job have a null actor and retain the recipient UUID.

`client` records are explicitly unverified, best-effort telemetry: signed-in page
navigation, control clicks/changes/submits, visibility/focus/connectivity events,
and Supabase HTTP request starts/successes/errors. Static control names or DOM
tag/index identify interactions. Generic HTTP events identify endpoint/method,
not the selected user/post or query filters. Keyboard typing and mouse movement
are deliberately not recorded. Server-confirmed login/session events are audited;
anonymous browsing and failed anonymous logins are not ingested by this endpoint.
Use Supabase Auth/platform logs for failed auth and server errors independent of
the browser. Rolled-back mutations have no successful database event; a browser
API error may be available instead.

Passwords, tokens, chat/request/notification contents, contact values, search
terms, URL parameters, and arbitrary form values are not copied into history.
Database audit stores identifiers, changed **field names**, status/read flags and
notification type, not before/after row snapshots. Admin user lists expose email
for moderation, but never auth secrets. User IDs and moderation reasons remain
sensitive: restrict admin membership, review privacy disclosures, and set a
retention policy appropriate to the deployment before enabling logging.

Browser logging is batched (50), memory-bounded (200), time-bounded, rate-limited
(600 events/user/minute), and isolated from application success/failure. It never
re-enters the auth callback or logs its own transport. It clears/aborts on identity
changes and backs off on failure. Uncertain batches are not retried to avoid
duplicates; tab close, offline periods, blockers, malicious clients and overload
can lose telemetry. This is **not a guarantee of every physical user action**.
No past activity is reconstructed; collection starts after applying 017.

Audit history intentionally has no user/post foreign keys, so account/post deletion
does not erase it. Browser accounts, including admins, cannot mutate it directly.
Trusted database operators can still alter history: this is not externally sealed
or cryptographically tamper-proof storage. Export to a dedicated audit sink if
that guarantee is required. No automatic purge is enabled. After approving a
retention policy, a trusted operator may archive and delete old records, e.g.:

```sql
-- Example only: choose retention periods for your deployment before executing.
delete from public.activity_events
where source = 'client' and created_at < now() - interval '30 days';
```

Monitor table size, write latency, and ingestion warnings. New business tables
need an audit trigger added explicitly; arbitrary future tables aren't covered.
Admin lists use stable ordering and offset pagination; concurrent writes may move
rows between pages, so refresh when needed.

### Verification

- `npm run test:admin`: isolated PostgreSQL tests for grants/RLS, privilege
  escalation, pagination, redaction, notification/session events, rate limits,
  deletion dependencies, rollback, protected admins, role revocation and Storage.
- `npm run test:itinerary-languages`: isolated PostgreSQL migration tests for the
  languages-known itinerary column and public search view.
- `npm run build`: Angular production compile.
- `npm run test:personal-activity`: PostgreSQL tests for personal-history isolation,
  redaction, pagination and filters; anonymous/public visibility; and request creation.
- With Angular running locally, `node scripts/verify-personal-activity.mjs` checks
  personal history, errors/retry, filters, pagination, anonymous search and requests.
  Use `ACTIVITY_TEST_URL` for a port other than 4201 and `PLAYWRIGHT_MODULE` for an
  external Playwright package. All external traffic is mocked or blocked.
- With Angular on `127.0.0.1:4201`, run `node scripts/verify-language-dropdown.mjs`
  with Playwright installed (`PLAYWRIGHT_MODULE` may point to its package directory).
  It checks selection/removal, create/edit payloads, legacy languages, the selection
  limit, keyboard access, and desktop/mobile layout with external traffic mocked.
  Set `LANGUAGE_TEST_URL` to use a different local port.
- Start Angular on `127.0.0.1:4201`, then run `node scripts/verify-admin.mjs` with
  Playwright installed (`PLAYWRIGHT_MODULE` can point to the package directory).
  Set `ADMIN_TEST_URL` for another local port. Headless Edge checks desktop/mobile,
  navigation/access, statistics, pagination, both deletion flows, cancellation,
  visible errors/retry, telemetry redaction/non-recursion and logging outages.
  All external HTTP/WebSocket traffic is mocked or blocked. No real data is deleted.
- In staging: grant a designated test admin; verify ordinary users are denied;
  create a trip/request/chat/subscription and matching notification; inspect
  database events; delete disposable post/account fixtures; verify preserved
  audit records. Then revoke the admin role and check that RPCs fail immediately.

Local tests do not apply the migration to production or validate custom production
foreign keys, Storage policies, Auth extensions or external integrations.
