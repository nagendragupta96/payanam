import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const planColumn = process.env.PAYANAM_TEST_SUBSCRIPTION_SCHEMA === 'plan' ? 'plan' : 'plan_code';
const user = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const ownTrip = '20000000-0000-0000-0000-000000000001';
const match = '20000000-0000-0000-0000-000000000002';
const migration = async (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const count = async () => Number((await db.query('select count(*) from public.notifications')).rows[0].count);
const activate = () => db.query(`update public.subscriptions set ${planColumn} = 'PREMIUM', status = 'ACTIVE' where user_id = $1`, [user]);
const retry = () => db.query('select public.backfill_premium_match_notifications($1) as count', [user]);

async function setup() {
  // Minimal pre-existing application schema: the repository's migrations assume
  // these base tables were provisioned separately. No remote Supabase is used.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create table public.profiles (id uuid primary key, display_name text, avatar_url text);
    create table public.itineraries (
      id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id),
      origin_airport text, destination_airport text, origin_airport_code text,
      destination_airport_code text, start_date date, end_date date,
      depart_date date, return_date date
    );
    create table public.itinerary_legs (
      itinerary_id uuid references public.itineraries(id), leg_order integer,
      origin_airport text, destination_airport text,
      origin_airport_code text, destination_airport_code text
    );
  `);
  if (planColumn === 'plan') {
    // Production has an id primary key and billing periods, not plan_code.
    // Do not assume an unreported unique constraint on user_id.
    await db.exec(`
      create table public.subscriptions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references auth.users(id), plan text,
        status text default 'ACTIVE', period_start timestamptz, period_end timestamptz,
        created_at timestamptz default now(), updated_at timestamptz default now()
      );
    `);
  }
  await db.exec(await migration('004_signup_atomic_profile_subscription.sql'));
  await db.exec(await migration('005_harden_signup_trigger_runtime.sql'));
  // PGlite provides core gen_random_uuid(), but does not bundle pgcrypto.
  const notifications = await migration('012_auto_match_notifications.sql');
  assert.ok(notifications.includes('create extension if not exists pgcrypto;'));
  await db.exec(notifications.replace('create extension if not exists pgcrypto;', ''));
  const existingUser = '10000000-0000-0000-0000-000000000003';
  await db.query('insert into auth.users (id) values ($1)', [existingUser]);
  if (planColumn === 'plan') {
    await db.query(`insert into public.subscriptions (user_id, plan, period_start, period_end)
      values ($1, 'PREMIUM', now() - interval '1 day', now() + interval '30 days')`, [existingUser]);
  } else {
    await db.query("update public.subscriptions set plan_code = 'PREMIUM' where user_id = $1", [existingUser]);
  }
  const beforeMigration = (await db.query('select * from public.subscriptions')).rows;
  const upgrade = await migration('013_premium_upgrade_match_notifications.sql');
  await db.exec(upgrade);
  await db.exec(upgrade); // Reapplying must not duplicate the activation trigger.
  assert.deepEqual((await db.query('select * from public.subscriptions')).rows, beforeMigration);
  const checkoutMigration = await migration('014_subscription_checkout.sql');
  await db.exec(checkoutMigration);
  await db.exec(checkoutMigration);
  if (planColumn === 'plan') {
    const { rows } = await db.query(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'plan_code'`);
    assert.equal(rows.length, 0, 'Compatibility must not add a second source of plan data');
  }
  await db.exec(`
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select, insert, update, delete on public.subscriptions to authenticated, service_role;
    grant select on public.notifications to authenticated;
    alter table public.itineraries enable row level security;
    alter table public.itinerary_legs enable row level security;
  `);
}

await setup();

beforeEach(async () => {
  await db.exec('begin');
  await db.query('insert into auth.users (id) values ($1), ($2)', [user, other]);
  if (planColumn === 'plan') {
    // Production provisioning is external; migration 005 skips its incompatible
    // optional subscription insert. Seed the existing records explicitly.
    await db.query("insert into public.subscriptions (user_id, plan) values ($1, 'FREE'), ($2, 'FREE')", [user, other]);
  }
  await db.query(`
    insert into public.itineraries
      (id, owner_id, origin_airport_code, destination_airport_code, start_date, end_date)
    values ($1, $2, 'JFK', 'LHR', current_date + 5, current_date + 10),
           ($3, $4, 'JFK', 'LHR', current_date + 10, current_date + 12)
  `, [ownTrip, user, match, other]);
});
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db.close(); });

test('FREE receives nothing; upgrade backfills a boundary-overlapping existing trip', async () => {
  assert.equal((await retry()).rows[0].count, 0);
  assert.equal(await count(), 0);
  await activate();
  const { rows } = await db.query('select user_id, itinerary_id, type, is_read from public.notifications');
  assert.deepEqual(rows, [{ user_id: user, itinerary_id: match, type: 'AUTO_MATCH', is_read: false }]);
});

test('pending payment creates nothing; activation and direct paid inserts trigger matching', async () => {
  await db.query(`update public.subscriptions set ${planColumn} = 'PREMIUM', status = 'PENDING' where user_id = $1`, [user]);
  assert.equal(await count(), 0);
  await activate();
  assert.equal(await count(), 1);
  await db.exec('delete from public.notifications');
  await db.query('delete from public.subscriptions where user_id = $1', [user]);
  await db.query(`insert into public.subscriptions (user_id, ${planColumn}, status) values ($1, 'premium', 'active')`, [user]);
  assert.equal(await count(), 1);
});

test('retries, repeated upgrades, reactivation and multiple owned trips preserve one read alert', async () => {
  await db.query(`insert into public.itineraries (owner_id, origin_airport_code, destination_airport_code, start_date, end_date)
    values ($1, 'JFK', 'LHR', current_date, current_date + 20)`, [user]);
  await activate();
  await db.exec('update public.notifications set is_read = true');
  assert.equal((await retry()).rows[0].count, 0);
  await activate();
  await db.query("update public.subscriptions set status = 'CANCELLED' where user_id = $1", [user]);
  assert.equal((await retry()).rows[0].count, 0);
  await activate();
  assert.equal(await count(), 1);
  assert.equal((await db.query('select is_read from public.notifications')).rows[0].is_read, true);
});

test('active-to-active updates do not run another scan', async () => {
  await activate();
  await db.exec('delete from public.notifications');
  await activate();
  assert.equal(await count(), 0);
});

test('wrong route, reverse route, disjoint dates, expired trips and own trips are excluded', async () => {
  await db.query('delete from public.itineraries where id = $1', [match]);
  await db.query(`insert into public.itineraries
    (owner_id, origin_airport_code, destination_airport_code, start_date, end_date) values
    ($1, 'LHR', 'JFK', current_date + 5, current_date + 10),
    ($1, 'JFK', 'CDG', current_date + 5, current_date + 10),
    ($1, 'JFK', 'LHR', current_date + 11, current_date + 12),
    ($1, 'JFK', 'LHR', current_date - 10, current_date - 1),
    ($2, 'JFK', 'LHR', current_date - 10, current_date - 1)`, [other, user]);
  await activate();
  assert.equal(await count(), 0);
});

test('expired owned criteria do not match an ongoing candidate', async () => {
  await db.query('update public.itineraries set start_date = current_date - 5, end_date = current_date - 1 where id = $1', [ownTrip]);
  await db.query('update public.itineraries set start_date = current_date - 5 where id = $1', [match]);
  await activate();
  assert.equal(await count(), 0);
});

test('legacy dates and airport fields match case-insensitively', async () => {
  await db.exec(`update public.itineraries set origin_airport = 'jfk', destination_airport = 'lhr',
    depart_date = start_date, return_date = end_date, start_date = null, end_date = null,
    origin_airport_code = null, destination_airport_code = null`);
  await activate();
  assert.equal(await count(), 1);
});

test('extra legs follow the existing matcher and reject mismatched connections', async () => {
  await db.query(`insert into public.itinerary_legs (itinerary_id, leg_order, origin_airport, destination_airport)
    values ($1, 2, 'CDG', 'LHR'), ($2, 2, 'AMS', 'LHR')`, [ownTrip, match]);
  await activate();
  assert.equal(await count(), 0);
  await db.query("update public.itinerary_legs set origin_airport = 'cdg' where itinerary_id = $1", [match]);
  assert.equal((await retry()).rows[0].count, 1);
});

test('notification insert errors do not undo activation; a later retry succeeds', async () => {
  await db.exec(`create function public.reject_test_notification() returns trigger language plpgsql as
    $$ begin raise exception 'Simulated notification failure'; end $$;
    create trigger reject_test_notification before insert on public.notifications
      for each row execute function public.reject_test_notification();`);
  await activate();
  assert.equal(await count(), 0);
  assert.equal((await db.query(`select ${planColumn} as plan from public.subscriptions where user_id = $1`, [user])).rows[0].plan, 'PREMIUM');
  await db.exec('drop trigger reject_test_notification on public.notifications');
  assert.equal((await retry()).rows[0].count, 1);
});

test('authenticated retry is limited to self, with owner-only notification visibility', async () => {
  await activate();
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [other]);
  await db.exec('set local role authenticated');
  assert.equal((await db.query('select public.create_premium_backfill_notifications() as count')).rows[0].count, 0);
  assert.equal(await count(), 0);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  assert.equal(await count(), 1);
  assert.equal((await db.query('select public.create_premium_backfill_notifications() as count')).rows[0].count, 0);
  const { rows } = await db.query(`select
    has_function_privilege('anon', 'public.create_premium_backfill_notifications()', 'execute') as anon,
    has_function_privilege('authenticated', 'public.backfill_premium_match_notifications(uuid)', 'execute') as arbitrary_user,
    has_function_privilege('service_role', 'public.backfill_premium_match_notifications(uuid)', 'execute') as backend`);
  assert.deepEqual(rows, [{ anon: false, arbitrary_user: false, backend: true }]);
});

test('browser clients cannot upgrade their subscription or insert a paid entitlement', async () => {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.exec('set local role authenticated');
  await activate();
  assert.equal((await db.query(`select ${planColumn} as plan from public.subscriptions where user_id = $1`, [user])).rows[0].plan, 'FREE');
  await db.exec('reset role');
  await db.query('delete from public.subscriptions where user_id = $1', [user]);
  await db.exec('set local role authenticated; savepoint denied_insert');
  await assert.rejects(db.query(`insert into public.subscriptions (user_id, ${planColumn}) values ($1, 'PREMIUM')`, [user]), /row-level security/);
  await db.exec('rollback to savepoint denied_insert');
  await db.query(`insert into public.subscriptions (user_id, ${planColumn}) values ($1, 'FREE')`, [user]);
});

test('new-trip notifications also support the subscription schema and reject free users', async () => {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [other]);
  const notify = () => db.query('select public.create_auto_match_notifications($1) as count', [match]);
  assert.equal((await notify()).rows[0].count, 0);
  await activate();
  await db.exec('delete from public.notifications');
  assert.equal((await notify()).rows[0].count, 1);
  assert.equal((await notify()).rows[0].count, 0);
  assert.equal(await count(), 1);
});

test('blank and missing plans do not qualify as Premium', async () => {
  await db.query(`update public.subscriptions set ${planColumn} = '  ' where user_id = $1`, [user]);
  assert.equal((await retry()).rows[0].count, 0);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [other]);
  assert.equal((await db.query('select public.create_auto_match_notifications($1) as count', [match])).rows[0].count, 0);
  for (const subscription of [{}, { plan: null }, { plan: '' }, { plan: null, plan_code: 'PREMIUM' }]) {
    assert.equal((await db.query('select public.notification_subscription_plan($1::jsonb) as plan',
      [JSON.stringify(subscription)])).rows[0].plan, null);
  }
  assert.equal((await db.query('select public.notification_subscription_plan($1::jsonb) as plan',
    [JSON.stringify({ plan: ' free ', plan_code: 'PREMIUM' })])).rows[0].plan, 'FREE');
  assert.equal(await count(), 0);
});

test('unrelated subscription updates do not rescan matching trips', async () => {
  await activate();
  await db.exec('delete from public.notifications');
  await db.query('update public.subscriptions set updated_at = now() where user_id = $1', [user]);
  assert.equal(await count(), 0);
});

async function signIn(id = user) {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
  await db.exec('set local role authenticated');
}
const startCheckout = async () => (await db.query('select * from public.create_subscription_checkout()')).rows[0];
const finishCheckout = async id => (await db.query('select * from public.complete_mock_subscription_checkout($1)', [id])).rows[0];
const overview = async () => (await db.query('select public.get_my_subscription() as subscription')).rows[0].subscription;
async function denied(sql, params, pattern) {
  await db.exec('savepoint denied');
  await assert.rejects(db.query(sql, params), pattern);
  await db.exec('rollback to savepoint denied');
}

test('mock checkout activates Premium, backfills matches, and is idempotent', async () => {
  await signIn();
  assert.equal((await overview()).is_premium, false);
  const checkout = await startCheckout();
  assert.equal(checkout.provider, 'mock');
  assert.equal((await startCheckout()).id, checkout.id);
  assert.equal((await overview()).is_premium, false);
  const completed = await finishCheckout(checkout.id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal((await overview()).is_premium, true);
  assert.equal(await count(), 1);
  assert.deepEqual(await finishCheckout(checkout.id), completed);
  assert.equal(await count(), 1);
  await denied('select public.create_subscription_checkout()', [], /already active/);
});

test('checkout provisions a subscription when signup had no compatible subscription row', async () => {
  await db.query('delete from public.subscriptions where user_id = $1', [user]);
  await signIn();
  const checkout = await startCheckout();
  await finishCheckout(checkout.id);
  assert.equal((await overview()).plan_code, 'PREMIUM');
  assert.equal(await count(), 1);
});

test('another user cannot inspect or complete a checkout', async () => {
  await signIn();
  const checkout = await startCheckout();
  await signIn(other);
  assert.equal((await db.query('select * from public.subscription_checkouts')).rows.length, 0);
  await denied('select public.complete_mock_subscription_checkout($1)', [checkout.id], /Checkout not found/);
  await denied('select public.cancel_subscription_checkout($1)', [checkout.id], /Checkout not found/);
  assert.equal((await overview()).is_premium, false);
});

test('clients cannot bypass fulfillment or change checkout/settings rows', async () => {
  await signIn();
  const checkout = await startCheckout();
  await denied('select public.fulfill_subscription_checkout($1, $2, $3)', [checkout.id, 'mock', 'fake'], /permission denied/);
  await denied("update public.subscription_checkouts set status = 'COMPLETED' where id = $1", [checkout.id], /permission denied/);
  await denied("insert into public.subscription_checkouts (user_id, plan_code, provider) values ($1, 'PREMIUM', 'mock')", [user], /permission denied/);
  await denied('update public.subscription_billing_settings set mock_enabled = true', [], /permission denied/);
});

test('cancelled and expired checkouts do not activate Premium', async () => {
  await signIn();
  const checkout = await startCheckout();
  await db.query('select public.cancel_subscription_checkout($1)', [checkout.id]);
  await denied('select public.complete_mock_subscription_checkout($1)', [checkout.id], /cancelled/);
  const next = await startCheckout();
  assert.notEqual(next.id, checkout.id);
  await db.exec('reset role');
  await db.query("update public.subscription_checkouts set expires_at = now() - interval '1 minute' where id = $1", [next.id]);
  await signIn();
  await denied('select public.complete_mock_subscription_checkout($1)', [next.id], /expired/);
  assert.equal((await overview()).is_premium, false);
  assert.notEqual((await startCheckout()).id, next.id);
});

test('server switch disables mock checkout including already pending sessions', async () => {
  await signIn();
  const checkout = await startCheckout();
  await db.exec('reset role; update public.subscription_billing_settings set mock_enabled = false');
  await signIn();
  assert.equal((await overview()).mock_enabled, false);
  await denied('select public.create_subscription_checkout()', [], /unavailable/);
  await denied('select public.complete_mock_subscription_checkout($1)', [checkout.id], /unavailable/);
  assert.equal((await overview()).is_premium, false);
});

test('a failed subscription write leaves checkout pending for a safe retry', async () => {
  await db.exec(`create function public.reject_checkout_activation() returns trigger language plpgsql as
    $$ begin raise exception 'Simulated activation failure'; end $$;
    create trigger reject_checkout_activation before update on public.subscriptions
      for each row execute function public.reject_checkout_activation();`);
  await signIn();
  const checkout = await startCheckout();
  await denied('select public.complete_mock_subscription_checkout($1)', [checkout.id], /Simulated activation failure/);
  assert.equal((await db.query('select status from public.subscription_checkouts where id = $1', [checkout.id])).rows[0].status, 'PENDING');
  assert.equal((await overview()).is_premium, false);
  await db.exec('reset role; drop trigger reject_checkout_activation on public.subscriptions');
  await signIn();
  assert.equal((await finishCheckout(checkout.id)).status, 'COMPLETED');
});

test('anonymous callers cannot start or complete checkout', async () => {
  await db.exec('set local role anon');
  await denied('select public.get_my_subscription()', [], /permission denied/);
  await denied('select public.create_subscription_checkout()', [], /permission denied/);
  await denied('select public.complete_mock_subscription_checkout($1)', [ownTrip], /permission denied/);
});
