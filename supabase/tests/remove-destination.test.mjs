import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const readMigration = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.itineraries (
      id uuid primary key default gen_random_uuid(), owner_id uuid,
      origin_airport_code text, destination_airport_code text,
      origin_airport text, destination_airport text, destination text,
      start_date date, end_date date, depart_date date, return_date date,
      created_at timestamptz default now()
    );
    create table public.itinerary_legs (
      id uuid primary key default gen_random_uuid(), itinerary_id uuid references public.itineraries,
      leg_order integer, origin_airport_code text, destination_airport_code text,
      origin_airport text, destination_airport text, flight_number text, flight_code text,
      departure_at timestamptz, arrival_at timestamptz
    );
    create table public.itinerary_contact_details (
      itinerary_id uuid references public.itineraries, contact_name text,
      contact_phone text, contact_email text, notes text
    );
    insert into public.itineraries (id, origin_airport_code, destination_airport_code, destination, start_date, end_date)
      values ('10000000-0000-0000-0000-000000000001', 'JFK', 'LHR', 'London', current_date, current_date + 1);
    insert into public.itinerary_legs (itinerary_id, leg_order, origin_airport_code, destination_airport_code, flight_number)
      values ('10000000-0000-0000-0000-000000000001', 1, 'JFK', 'LHR', 'BA123');
    insert into public.itinerary_contact_details (itinerary_id, contact_phone)
      values ('10000000-0000-0000-0000-000000000001', '+1 202 555 0123');
  `);
  await db.exec(await readMigration('011_public_search_has_contact_details.sql'));
  return db;
}

test('destination removal preserves airport routing, legs, private contacts and public access', async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from public.public_itinerary_search')).rows[0];
    const { destination, ...expected } = before;
    assert.equal(destination, 'London');
    const migration = await readMigration('015_remove_optional_destination.sql');
    await db.exec(migration);
    await db.exec(migration);
    const columns = await db.query(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name in ('itineraries', 'public_itinerary_search') and column_name = 'destination'`);
    assert.equal(columns.rows.length, 0);
    await db.exec('set role anon');
    assert.deepEqual((await db.query('select * from public.public_itinerary_search')).rows[0], expected);
    await db.exec('reset role');
    assert.equal((await db.query('select contact_phone from public.itinerary_contact_details')).rows[0].contact_phone, '+1 202 555 0123');
    await db.exec("insert into public.itineraries (origin_airport_code, destination_airport_code) values ('BOS', 'CDG')");
    await db.exec("update public.itineraries set destination_airport_code = 'SIN' where origin_airport_code = 'BOS'");
    assert.equal((await db.query("select destination_airport_code from public.public_itinerary_search where origin_airport_code = 'BOS'")).rows[0].destination_airport_code, 'SIN');
  } finally { await db.close(); }
});

test('unknown downstream view dependencies abort the removal without cascading deletes', async () => {
  const db = await fixture();
  try {
    await db.exec('create view public.custom_report as select * from public.public_itinerary_search');
    await assert.rejects(db.exec(await readMigration('015_remove_optional_destination.sql')), /depend/);
    await db.exec('rollback');
    assert.equal((await db.query('select destination from public.custom_report')).rows[0].destination, 'London');
  } finally { await db.close(); }
});
