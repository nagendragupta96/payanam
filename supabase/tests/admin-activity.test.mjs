import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../017_admin_activity.sql', import.meta.url), 'utf8');
const grantScript = await readFile(new URL('../admin/grant_admin.sql', import.meta.url), 'utf8');
const admin = '10000000-0000-0000-0000-000000000001';
const member = '10000000-0000-0000-0000-000000000002';
const other = '10000000-0000-0000-0000-000000000003';
const trip = '20000000-0000-0000-0000-000000000001';
const request = '30000000-0000-0000-0000-000000000001';
const thread = '40000000-0000-0000-0000-000000000001';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz,
      encrypted_password text, raw_user_meta_data jsonb default '{}');
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade);
    create table public.profiles (id uuid primary key references auth.users, display_name text);
    create table public.itineraries (id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users,
      origin_airport_code text, destination_airport_code text, start_date date default current_date,
      end_date date default current_date + 1, created_at timestamptz default now());
    create table public.itinerary_legs (id uuid primary key default gen_random_uuid(), itinerary_id uuid references public.itineraries);
    create table public.itinerary_contact_details (itinerary_id uuid primary key references public.itineraries, owner_id uuid references auth.users, contact_phone text);
    create table public.requests (id uuid primary key default gen_random_uuid(), itinerary_id uuid references public.itineraries,
      owner_id uuid references auth.users, requester_id uuid references auth.users, status text, message text);
    create table public.chat_threads (id uuid primary key default gen_random_uuid(), itinerary_id uuid references public.itineraries,
      request_id uuid references public.requests, owner_id uuid references auth.users, requester_id uuid references auth.users);
    create table public.chat_messages (id uuid primary key default gen_random_uuid(), thread_id uuid references public.chat_threads,
      sender_id uuid references auth.users, body text);
    create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users,
      itinerary_id uuid references public.itineraries, type text, title text, body text, is_read boolean default false);
    create table public.subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users, plan text, status text);
    create table public.subscription_checkouts (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users, provider text, status text);
    create function public.notification_subscription_plan(s jsonb) returns text language sql immutable as $$ select coalesce(s->>'plan', s->>'plan_code', 'FREE') $$;
    insert into auth.users (id, email, raw_user_meta_data) values ('${admin}', 'admin@example.invalid', '{}'),
      ('${member}', 'member@example.invalid', '{"is_admin":true}'), ('${other}', 'other@example.invalid', '{}');
    insert into public.profiles values ('${admin}', 'Administrator'), ('${member}', 'Member'), ('${other}', 'Other');
  `);
  await db.exec(migration);
  await db.exec(grantScript.replace('replace-with-admin@example.com', 'admin@example.invalid'));
  await db.exec(`
    insert into public.itineraries (id, owner_id, origin_airport_code, destination_airport_code) values ('${trip}', '${member}', 'JFK', 'LHR');
    insert into public.itinerary_legs (itinerary_id) values ('${trip}');
    insert into public.itinerary_contact_details values ('${trip}', '${member}', 'PRIVATE PHONE');
    insert into public.requests (id, itinerary_id, owner_id, requester_id, status, message) values ('${request}', '${trip}', '${member}', '${other}', 'PENDING', 'PRIVATE REQUEST');
    insert into public.chat_threads (id, itinerary_id, request_id, owner_id, requester_id) values ('${thread}', '${trip}', '${request}', '${member}', '${other}');
    insert into public.chat_messages (thread_id, sender_id, body) values ('${thread}', '${other}', 'PRIVATE CHAT');
    insert into public.notifications (user_id, itinerary_id, type, title, body) values ('${other}', '${trip}', 'AUTO_MATCH', 'PRIVATE TITLE', 'PRIVATE NOTIFICATION');
    insert into public.subscriptions(user_id, plan, status) values ('${member}', 'PREMIUM', 'ACTIVE');
    insert into public.subscription_checkouts(user_id, provider, status) values ('${member}', 'mock', 'COMPLETED');
    insert into auth.sessions(user_id) values ('${member}');
  `);
  return db;
}
async function asUser(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
}
async function rpc(db, sql, params = []) { return (await db.query(sql, params)).rows[0]?.result; }

test('admin SQL grant is idempotent; regular users cannot self-promote or access admin RPCs', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(grantScript.replace('replace-with-admin@example.com', 'admin@example.invalid'));
    await asUser(db, member);
    assert.equal(await rpc(db, 'select public.is_app_admin() as result'), false);
    for (const sql of [
      'select public.admin_overview()', "select public.admin_list('users')",
      `select public.admin_delete_post('${trip}', 'testing')`, `select public.admin_delete_user('${other}', 'testing')`,
      `insert into public.app_admins(user_id) values('${member}')`, 'select * from public.activity_events',
      `select public.admin_remove_post_data('${trip}')`, 'select public.require_app_admin()',
      "insert into public.activity_events(source,action) values('admin','forged')",
      "update public.activity_events set action='forged'", 'delete from public.activity_events'
    ]) await assert.rejects(db.exec(sql), /permission denied|Administrator access required/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select public.is_app_admin()'), /permission denied/);
    await assert.rejects(db.exec('select public.admin_overview()'), /permission denied/);
    await assert.rejects(db.exec("select public.record_client_activity('[]')"), /permission denied/);
  } finally { await db.close(); }
});

test('admin stats, safe paginated lists, filters and read auditing', async () => {
  const db = await fixture();
  try {
    await asUser(db, admin);
    const stats = await rpc(db, 'select public.admin_overview() as result');
    assert.equal(stats.users, 3); assert.equal(stats.posts, 1); assert.equal(stats.premium_users, 1);
    assert.equal(stats.pending_requests, 1); assert.equal(stats.messages, 1); assert.equal(stats.unread_notifications, 1);
    assert.equal(stats.completed_demo_checkouts, 1);
    const page = await rpc(db, "select public.admin_list('users', '', 0, 2) as result");
    assert.equal(page.total, 3); assert.equal(page.rows.length, 2);
    assert.equal(Object.hasOwn(page.rows[0], 'encrypted_password'), false);
    const second = await rpc(db, "select public.admin_list('users', '', 2, 2) as result");
    assert.equal(second.rows.length, 1); assert.ok(!page.rows.some(row => row.id === second.rows[0].id));
    assert.equal((await rpc(db, "select public.admin_list('users', $1) as result", ["' OR 1=1 --"])).total, 0);
    assert.equal((await rpc(db, "select public.admin_list('posts', 'JFK') as result")).total, 1);
    const events = await rpc(db, "select public.admin_list('activity', 'admin.overview', 0, 25, 'admin', $1) as result", [admin]);
    assert.equal(events.rows.length, 1); assert.equal(events.rows[0].actor_is_admin, true);
    const userEvents = await rpc(db, "select public.admin_list('user-activity', '', 0, 25, '', $1) as result", [other]);
    assert.ok(userEvents.total > 0);
    assert.ok(userEvents.rows.some(row => row.actor_id === other || row.subject_user_id === other));
    assert.ok(userEvents.rows.some(row => row.actor_email === 'other@example.invalid' || row.subject_email === 'other@example.invalid'));
    await assert.rejects(db.exec("select public.admin_list('bad')"), /Invalid admin section/);
    await assert.rejects(db.exec("select public.admin_list('users', '', -1, 25)"), /Invalid list parameters/);
    await assert.rejects(db.exec("select public.admin_list('users', '', 0, 101)"), /Invalid list parameters/);
  } finally { await db.close(); }
});

test('database audit covers mutations, notifications, session events without private values', async () => {
  const db = await fixture();
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [member]);
    await db.exec(`update auth.users set encrypted_password = 'PRIVATE PASSWORD' where id = '${member}';
      update public.notifications set is_read = true;
      update public.requests set status = 'ACCEPTED';
      delete from auth.sessions;`);
    const rows = (await db.query('select * from public.activity_events')).rows;
    assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
    assert.ok(rows.some(r => r.action === 'notifications.insert' && r.details.notification_type === 'AUTO_MATCH' && r.subject_user_id === other));
    assert.ok(rows.some(r => r.action === 'notifications.update' && r.details.is_read === true));
    assert.ok(rows.some(r => r.action === 'requests.update' && r.details.previous_status === 'PENDING' && r.details.status === 'ACCEPTED'));
    assert.ok(rows.some(r => r.action === 'sessions.insert')); assert.ok(rows.some(r => r.action === 'sessions.delete'));
    assert.equal(rows.filter(r => r.action === 'notification.available').length, 2);
    assert.ok(rows.some(r => r.action === 'users.update' && r.actor_id === member && !r.actor_is_admin));
  } finally { await db.close(); }
});

test('browser telemetry cannot spoof actor/source/role and has validation and rate limits', async () => {
  const db = await fixture();
  try {
    await asUser(db, member);
    await db.query('select public.record_client_activity($1)', [JSON.stringify([
      { action: 'click', area: 'search', control: 'button:1', actor_id: admin, source: 'admin', actor_is_admin: true, password: 'PRIVATE' }
    ])]);
    await assert.rejects(db.exec(`select public.record_client_activity('[{"action":"admin.delete_user"}]')`), /Invalid activity action/);
    await assert.rejects(db.exec(`select public.record_client_activity('[{"action":"click","area":"email@example.com"}]')`), /Invalid activity context/);
    await assert.rejects(db.query('select public.record_client_activity($1)', [JSON.stringify(Array(51).fill({ action: 'click' }))]), /Invalid activity batch/);
    const batch = JSON.stringify(Array(50).fill({ action: 'click', area: 'search' }));
    for (let i = 0; i < 11; i++) await db.query('select public.record_client_activity($1)', [batch]);
    await assert.rejects(db.query('select public.record_client_activity($1)', [batch]), /rate limit/);
    await db.exec('reset role');
    const row = (await db.query("select * from public.activity_events where source='client' order by id limit 1")).rows[0];
    assert.equal(row.actor_id, member); assert.equal(row.actor_is_admin, false); assert.equal(row.source, 'client');
    assert.deepEqual(row.details, { area: 'search', control: 'button:1' });
  } finally { await db.close(); }
});

test('deleting posts removes dependent rows, preserves history and requires a reason', async () => {
  const db = await fixture();
  try {
    await asUser(db, admin);
    await assert.rejects(db.exec(`select public.admin_delete_post('${trip}', '')`), /reason/);
    await db.exec(`select public.admin_delete_post('${trip}', 'Duplicate trip')`);
    await db.exec('reset role');
    for (const table of ['itineraries', 'itinerary_legs', 'itinerary_contact_details', 'requests', 'chat_threads', 'chat_messages', 'notifications']) {
      assert.equal(Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n), 0, table);
    }
    const audit = (await db.query("select * from public.activity_events where action='admin.delete_post'")).rows[0];
    assert.equal(audit.actor_id, admin); assert.equal(audit.entity_id, trip); assert.equal(audit.details.reason, 'Duplicate trip');
    assert.ok((await db.query("select * from public.activity_events where action='itineraries.insert'")).rows.length);
  } finally { await db.close(); }
});

test('account deletion is atomic, deletes auth identity/sessions, preserves other users and audit', async () => {
  const db = await fixture();
  try {
    await asUser(db, admin);
    await db.exec(`select public.admin_delete_user('${member}', 'Abuse report confirmed')`);
    await db.exec('reset role');
    assert.equal((await db.query('select id from auth.users order by id')).rows.length, 2);
    assert.equal((await db.query('select * from auth.sessions')).rows.length, 0);
    for (const table of ['profiles', 'subscriptions', 'subscription_checkouts', 'itineraries']) {
      const key = table === 'profiles' ? 'id' : table === 'itineraries' ? 'owner_id' : 'user_id';
      assert.equal((await db.query(`select * from public.${table} where ${key}=$1`, [member])).rows.length, 0);
    }
    assert.equal((await db.query("select * from public.activity_events where action='admin.delete_user' and subject_user_id=$1", [member])).rows.length, 1);
    await asUser(db, member);
    assert.equal(await rpc(db, 'select public.is_app_admin() as result'), false);
    await assert.rejects(db.exec(`select public.record_client_activity('[{"action":"click"}]')`), /Sign in required/);
  } finally { await db.close(); }
});

test('self and other administrators are protected, revoked privileges take effect immediately', async () => {
  const db = await fixture();
  try {
    await db.exec(`insert into public.app_admins values('${other}')`);
    await asUser(db, admin);
    for (const id of [admin, other]) await assert.rejects(db.exec(`select public.admin_delete_user('${id}', 'Testing guard')`), /Admin accounts cannot be deleted/);
    await db.exec('reset role');
    await db.exec(`delete from public.app_admins where user_id='${admin}'`);
    await asUser(db, admin);
    await assert.rejects(db.exec('select public.admin_overview()'), /Administrator access required/);
  } finally { await db.close(); }
});

test('unknown FK dependencies roll back cleanup and success audit entries', async () => {
  const db = await fixture();
  try {
    await db.exec(`create table public.custom_dependency(user_id uuid references auth.users); insert into public.custom_dependency values('${member}')`);
    await asUser(db, admin);
    await assert.rejects(db.exec(`select public.admin_delete_user('${member}', 'Testing rollback')`), /foreign key/);
    await db.exec('reset role');
    assert.equal((await db.query('select * from public.itineraries')).rows.length, 1);
    assert.equal((await db.query('select * from public.chat_messages')).rows.length, 1);
    assert.equal((await db.query("select * from public.activity_events where action='admin.delete_user'")).rows.length, 0);
  } finally { await db.close(); }
});

test('storage ownership blocks account deletion before any app data is removed', async () => {
  const db = await fixture();
  try {
    await db.exec(`create schema storage; create table storage.objects(owner_id text); insert into storage.objects values('${member}')`);
    await asUser(db, admin);
    await assert.rejects(db.exec(`select public.admin_delete_user('${member}', 'Testing storage')`), /Storage files/);
    await db.exec('reset role');
    assert.equal((await db.query('select * from public.itineraries')).rows.length, 1);
    assert.equal((await db.query('select * from auth.users')).rows.length, 3);
  } finally { await db.close(); }
});
