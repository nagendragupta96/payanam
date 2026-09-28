import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../019_personal_activity_anonymous_trips.sql', import.meta.url), 'utf8');
const languages = await readFile(new URL('../018_itinerary_languages_known.sql', import.meta.url), 'utf8');
const audit = await readFile(new URL('../017_admin_activity.sql', import.meta.url), 'utf8');
const owner = '10000000-0000-0000-0000-000000000001';
const viewer = '10000000-0000-0000-0000-000000000002';
const third = '10000000-0000-0000-0000-000000000003';
const trip = '20000000-0000-0000-0000-000000000001';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${owner}'), ('${viewer}'), ('${third}');
    create table public.profiles (id uuid primary key, display_name text);
    insert into public.profiles values ('${owner}', 'Private owner name');
    create table public.activity_events (
      id bigint generated always as identity primary key, created_at timestamptz default now(),
      actor_id uuid, actor_is_admin boolean default false, subject_user_id uuid, source text, action text, entity_type text, entity_id text,
      details jsonb default '{}'
    );
    alter table public.activity_events enable row level security;
    create table public.itineraries (
      id uuid primary key default gen_random_uuid(), owner_id uuid, origin_airport_code text,
      destination_airport_code text, origin_airport text, destination_airport text,
      start_date date default current_date, end_date date default current_date + 1,
      depart_date date, return_date date, created_at timestamptz default now()
    );
    create table public.itinerary_legs (
      id uuid primary key default gen_random_uuid(), itinerary_id uuid references public.itineraries,
      leg_order integer, origin_airport_code text, destination_airport_code text,
      origin_airport text, destination_airport text, flight_number text, flight_code text,
      departure_at timestamptz, arrival_at timestamptz
    );
    create table public.itinerary_contact_details (
      itinerary_id uuid references public.itineraries, contact_name text, contact_phone text, contact_email text, notes text
    );
    create table public.requests (
      id uuid primary key default gen_random_uuid(), itinerary_id uuid references public.itineraries,
      owner_id uuid, requester_id uuid, request_type text, status text, message text, created_at timestamptz default now()
    );
    create unique index active_request on public.requests(itinerary_id, requester_id, request_type) where status in ('PENDING', 'ACCEPTED');
    create table public.chat_threads (id uuid primary key, itinerary_id uuid, owner_id uuid, requester_id uuid);
    create table public.chat_messages (id uuid primary key default gen_random_uuid(), thread_id uuid, sender_id uuid, body text);
    create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, itinerary_id uuid, type text, title text, body text, is_read boolean default false);
    create table public.subscriptions (id uuid primary key, user_id uuid, plan text, status text);
    create table public.subscription_checkouts (id uuid primary key, user_id uuid, provider text, status text);
    alter table public.requests enable row level security;
    create policy request_participant on public.requests for select to authenticated using (requester_id = auth.uid() or owner_id = auth.uid());
    grant select on public.requests to authenticated;
    grant select on public.itineraries to anon, authenticated;
    grant update, insert on public.itineraries to authenticated;
    alter table public.itineraries enable row level security;
    create policy existing_read on public.itineraries for select using (true);
    create policy existing_update on public.itineraries for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
    insert into public.itineraries(id, owner_id, origin_airport_code, destination_airport_code) values('${trip}', '${owner}', 'JFK', 'HYD');
    insert into public.itinerary_contact_details values('${trip}', 'SECRET CONTACT', null, null, null);
  `);
  await db.exec(audit);
  await db.exec(languages);
  await db.exec(migration);
  return db;
}
async function asUser(db, id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec(`set role ${role}`);
}
async function activity(db, before = null, limit = 25, category = 'all') {
  return (await db.query('select public.my_activity($1, $2, $3) as result', [before, limit, category])).rows[0].result;
}

test('personal activity is caller-scoped, paginated, filtered, and redacts private metadata', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(`insert into public.activity_events(actor_id,subject_user_id,source,action,entity_type,details) values
      ('${owner}', null, 'client', 'click', null, '{"area":"create-itinerary","control":"publish","reason":"SECRET"}'),
      ('${viewer}', '${owner}', 'database', 'notifications.insert', 'notifications', '{"notification_type":"AUTO_MATCH","body":"SECRET","email":"SECRET"}'),
      ('${viewer}', '${viewer}', 'client', 'navigation', null, '{}'),
      (null, '${owner}', 'database', 'sessions.insert', 'sessions', '{}');`);
    await asUser(db, owner);
    const first = await activity(db, null, 2);
    assert.equal(first.has_more, true); assert.equal(first.rows.length, 2);
    assert.equal(first.rows[0].action, 'sessions.insert');
    assert.equal(first.rows[1].affects_you, true); assert.equal(first.rows[1].performed_by_you, false);
    assert.ok(!JSON.stringify(first).includes(viewer)); assert.ok(!JSON.stringify(first).includes('SECRET'));
    const second = await activity(db, first.rows.at(-1).id, 2);
    assert.equal(second.rows.length, 1); assert.equal(second.has_more, false);
    assert.equal(second.rows[0].action, 'click');
    assert.equal((await activity(db, null, 25, 'notifications')).rows.length, 1);
    assert.equal((await activity(db, null, 25, 'actions')).rows.length, 2);
    await assert.rejects(activity(db, null, 101), /Invalid activity/);
    await assert.rejects(activity(db, -1), /Invalid activity/);
    await assert.rejects(activity(db, null, 25, 'invalid'), /Invalid activity/);
    await assert.rejects(db.query('select * from public.activity_events'), /permission denied/);
    await asUser(db, third);
    assert.deepEqual((await activity(db)).rows, []);
    await asUser(db, null, 'anon');
    await assert.rejects(activity(db), /permission denied/);
    await asUser(db, null);
    await assert.rejects(activity(db), /Sign in required/);
  } finally { await db.close(); }
});

test('anonymous search redacts identity, raw reads cannot bypass it, and owners can change visibility', async () => {
  const db = await fixture();
  try {
    await asUser(db, owner);
    assert.equal((await db.query('select is_anonymous from public.itineraries')).rows[0].is_anonymous, false);
    await db.exec(`update public.itineraries set is_anonymous = true where id = '${trip}'`);
    for (const [id, role] of [[viewer, 'authenticated'], [null, 'anon']]) {
      await asUser(db, id, role);
      const row = (await db.query('select * from public.public_itinerary_search')).rows[0];
      assert.equal(row.owner_id, null); assert.equal(row.posted_by, 'Anonymous');
      assert.equal(row.has_contact_details, true);
      assert.ok(!JSON.stringify(row).includes('SECRET')); assert.ok(!JSON.stringify(row).includes('Private owner name'));
      assert.equal((await db.query('select * from public.itineraries')).rows.length, 0);
    }
    await asUser(db, owner);
    assert.equal((await db.query('select * from public.itineraries')).rows.length, 1);
    await db.exec(`update public.itineraries set is_anonymous = false where id = '${trip}'`);
    await asUser(db, viewer);
    assert.equal((await db.query('select posted_by from public.public_itinerary_search')).rows[0].posted_by, 'Private owner name');
  } finally { await db.close(); }
});

test('server-created requests preserve anonymous trip workflows and reject spoofing/self/guest requests', async () => {
  const db = await fixture();
  try {
    await db.exec(`update public.itineraries set is_anonymous = true`);
    await asUser(db, viewer);
    const request = async type => (await db.query('select public.create_itinerary_request($1, $2) as result', [trip, type])).rows[0].result;
    const first = await request('COMPANION');
    assert.equal(first.existing, false); assert.equal(first.data.owner_id, owner); assert.equal(first.data.requester_id, viewer);
    const repeat = await request('COMPANION');
    assert.equal(repeat.existing, true); assert.equal(repeat.data.id, first.data.id);
    assert.equal((await request('CONTACT_DETAILS')).existing, false);
    const sent = await activity(db);
    assert.ok(sent.rows.some(event => event.action === 'requests.insert' && event.performed_by_you));
    assert.equal((await db.query('select * from public.itineraries')).rows.length, 1);
    assert.equal((await db.query('select owner_id from public.public_itinerary_search')).rows[0].owner_id, null);
    await assert.rejects(request('INVALID'), /Invalid request/);
    await asUser(db, owner);
    assert.ok((await activity(db, null, 25, 'notifications')).rows.some(event => event.action === 'notification.available' && event.affects_you));
    await assert.rejects(request('COMPANION'), /own trip/);
    await asUser(db, third);
    assert.equal((await db.query('select * from public.itineraries')).rows.length, 0);
    await asUser(db, null, 'anon');
    await assert.rejects(request('COMPANION'), /permission denied/);
    await asUser(db, null);
    await assert.rejects(request('COMPANION'), /Sign in required/);
  } finally { await db.close(); }
});

test('notification creation/read changes and button events appear in personal history', async () => {
  const db = await fixture();
  try {
    await asUser(db, owner);
    await db.query('select public.record_client_activity($1)', [JSON.stringify([{ action: 'click', area: 'create-itinerary', control: 'publish' }])]);
    await db.exec('reset role');
    await db.exec(`insert into public.notifications(user_id, itinerary_id, type, title, body)
      values('${viewer}', '${trip}', 'AUTO_MATCH', 'PRIVATE TITLE', 'PRIVATE BODY');
      update public.notifications set is_read = true;`);
    await asUser(db, viewer);
    const history = await activity(db, null, 25, 'notifications');
    assert.ok(history.rows.some(event => event.action === 'notifications.insert' && event.affects_you));
    assert.ok(history.rows.some(event => event.action === 'notifications.update' && event.details.is_read));
    assert.ok(!JSON.stringify(history).includes('PRIVATE'));
    await asUser(db, owner);
    assert.ok((await activity(db)).rows.some(event => event.action === 'click' && event.details.control === 'publish'));
  } finally { await db.close(); }
});
