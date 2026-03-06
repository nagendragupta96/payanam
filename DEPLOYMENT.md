# Cloudflare Pages Deployment Guide

## 1) Supabase setup
1. Create a Supabase project.
2. Enable Auth provider: Email.
3. Ensure **Auth → URL Configuration** is set:
   - Site URL (your app URL)
   - Redirect URL includes `/auth` route
4. Run your project schema SQL (tables) and then run:
   - `supabase/001_auth_profiles_bootstrap.sql`
   - `supabase/002_trip_contact_requests_chat.sql`
   - `supabase/003_airport_codes_public_search_and_notifications.sql`
   - `supabase/004_signup_atomic_profile_subscription.sql`
   - `supabase/005_harden_signup_trigger_runtime.sql`

This adds:
- RLS policies for `profiles`
- trigger `on_auth_user_created` to auto-create `profiles` row from `auth.users`

## 2) Configure Angular environment
Update `src/environments/environment.ts`:
- `supabaseUrl`
- `supabaseAnonKey`

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
