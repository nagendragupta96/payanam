# TravelCompanion

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 17.3.17.

## Supabase configuration (required)

Before signup/login can work, replace placeholders in:

- `src/environments/environment.ts`
- `src/environments/environment.prod.ts`

Set valid values for `supabaseUrl` and `supabaseAnonKey` from your Supabase project.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.

## OAuth setup (Google)

To make **Continue with Google** work, configure Supabase Authentication:

1. In Supabase Dashboard → **Authentication → Providers**
   - Enable **Google** and set Client ID / Secret.
2. In Supabase Dashboard → **Authentication → URL Configuration**
   - Set **Site URL** to your app base URL (dev: `http://localhost:4200`, prod: your deployed domain).
   - Add redirect URL(s) used by this app (for example `http://localhost:4200/auth` and your production `/auth` URL).
3. In this project, keep `emailRedirectUrl` in `src/environments/environment.ts` and `environment.prod.ts` aligned with those redirect URLs.

If a provider is disabled/misconfigured, the app will show a clear error message at the top of the auth page.

