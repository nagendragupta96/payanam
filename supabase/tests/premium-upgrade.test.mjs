import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const user = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const ownTrip = '20000000-0000-0000-0000-000000000001';
const match = '20000000-0000-0000-0000-000000000002';
const migration = async (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const count = async () => Number((await db.query('select count(*) from public.notifications')).rows[0].count);
const activate = () => db.query("update public.subscriptions set plan_code = 'PREMIUM', status = 'ACTIVE' where user_id = $1", [user]);
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
  await db.exec(await migration('004_signup_atomic_profile_subscription.sql'));
  // PGlite provides core gen_random_uuid(), but does not bundle pgcrypto.
  const notifications = await migration('012_auto_match_notifications.sql');
  assert.ok(notifications.includes('create extension if not exists pgcrypto;'));
  await db.exec(notifications.replace('create extension if not exists pgcrypto;', ''));
  const upgrade = await migration('013_premium_upgrade_match_notifications.sql');
  await db.exec(upgrade);
  await db.exec(upgrade); // Reapplying must not duplicate the activation trigger.
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
  await db.query("update public.subscriptions set plan_code = 'PREMIUM', status = 'PENDING' where user_id = $1", [user]);
  assert.equal(await count(), 0);
  await activate();
  assert.equal(await count(), 1);
  await db.exec('delete from public.notifications');
  await db.query('delete from public.subscriptions where user_id = $1', [user]);
  await db.query("insert into public.subscriptions (user_id, plan_code, status) values ($1, 'premium', 'active')", [user]);
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
  assert.equal((await db.query('select plan_code from public.subscriptions where user_id = $1', [user])).rows[0].plan_code, 'PREMIUM');
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
  assert.equal((await db.query('select plan_code from public.subscriptions where user_id = $1', [user])).rows[0].plan_code, 'FREE');
  await db.exec('reset role');
  await db.query('delete from public.subscriptions where user_id = $1', [user]);
  await db.exec('set local role authenticated; savepoint denied_insert');
  await assert.rejects(db.query("insert into public.subscriptions (user_id, plan_code) values ($1, 'PREMIUM')", [user]), /row-level security/);
  await db.exec('rollback to savepoint denied_insert');
  await db.query("insert into public.subscriptions (user_id, plan_code) values ($1, 'FREE')", [user]);
});
