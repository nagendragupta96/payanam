# Cloudflare Pages Deployment Guide

## 1) Supabase setup
1. Create a Supabase project.
2. Enable Auth providers (email/password minimum).
3. Create Postgres tables: `profiles`, `itineraries`, `travel_requests`, `messages`.
4. Enable Realtime on `messages` (and optionally `travel_requests`).
5. Set Row Level Security policies to restrict records to authorized users.

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
5. Add environment variables (optional, for CI scripts):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Deploy.

## 5) SPA routing support
This repo includes `src/_redirects` and `angular.json` assets config so Cloudflare serves `index.html` for client routes.

## 6) Optional Wrangler deployment
You can also deploy with Wrangler using `wrangler.toml`:
```bash
npm run build
npx wrangler pages deploy dist/travel-companion/browser
```
