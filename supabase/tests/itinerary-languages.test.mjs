import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../018_itinerary_languages_known.sql', import.meta.url), 'utf8');

test('018 adds itinerary languages and exposes them through public search', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table public.itineraries (
        id uuid primary key default gen_random_uuid(),
        owner_id uuid,
        origin_airport_code text,
        destination_airport_code text,
        origin_airport text,
        destination_airport text,
        start_date date default current_date,
        end_date date default current_date + 1,
        depart_date date,
        return_date date,
        created_at timestamptz default now()
      );
      create table public.itinerary_legs (
        id uuid primary key default gen_random_uuid(),
        itinerary_id uuid references public.itineraries,
        leg_order integer,
        origin_airport_code text,
        destination_airport_code text,
        origin_airport text,
        destination_airport text,
        flight_number text,
        flight_code text,
        departure_at timestamptz,
        arrival_at timestamptz
      );
      create table public.itinerary_contact_details (
        itinerary_id uuid references public.itineraries,
        contact_name text,
        contact_phone text,
        contact_email text,
        notes text
      );
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.query(
      `insert into public.itineraries (origin_airport_code, destination_airport_code, languages_known)
       values ('JFK', 'HYD', $1)`,
      [['English', 'Telugu']]
    );
    const rows = (await db.query('select origin_airport_code, destination_airport_code, languages_known from public.public_itinerary_search')).rows;
    assert.deepEqual(rows[0].languages_known, ['English', 'Telugu']);
    await assert.rejects(
      db.query('insert into public.itineraries (languages_known) values ($1)', [Array.from({ length: 21 }, (_, index) => `L${index}`)]),
      /itineraries_languages_known_reasonable/
    );
  } finally {
    await db.close();
  }
});
