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

test('a legacy trigger reproduces the publishing error after an unchecked column drop', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      create function public.legacy_destination_trigger() returns trigger language plpgsql as
      $$ begin perform new.destination; return new; end $$;
      create trigger legacy_destination before insert or update on public.itineraries
        for each row execute function public.legacy_destination_trigger();
      drop view public.public_itinerary_search;
      alter table public.itineraries drop column destination;
    `);
    await assert.rejects(
      db.exec("insert into public.itineraries (origin_airport_code, destination_airport_code) values ('JFK', 'LHR')"),
      /record "new" has no field "destination"/
    );
  } finally { await db.close(); }
});

for (const reference of ['new.destination', 'OLD . "destination"']) {
  test('preflight prevents destructive removal with legacy reference ' + reference, async () => {
    const db = await fixture();
    try {
      await db.exec(`
        create function public.legacy_destination_trigger() returns trigger language plpgsql as
        $$ begin perform ${reference}; return new; end $$;
        create trigger legacy_destination before update on public.itineraries
          for each row execute function public.legacy_destination_trigger();
      `);
      await assert.rejects(db.exec(await readMigration('015_remove_optional_destination.sql')), /legacy_destination.*legacy_destination_trigger/i);
      await db.exec('rollback');
      assert.equal((await db.query('select destination from public.public_itinerary_search')).rows[0].destination, 'London');
      await db.exec("update public.itineraries set destination = 'Still writable'");
    } finally { await db.close(); }
  });
}

test('airport-only validation triggers remain enabled and usable after removal', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      create function public.validate_airports() returns trigger language plpgsql as
      $$ begin
        if new.destination_airport_code = new.origin_airport_code then
          raise exception 'Airports must differ';
        end if;
        return new;
      end $$;
      create trigger validate_airports before insert or update on public.itineraries
        for each row execute function public.validate_airports();
    `);
    await db.exec(await readMigration('015_remove_optional_destination.sql'));
    await db.exec("insert into public.itineraries (origin_airport_code, destination_airport_code) values ('BOS', 'CDG')");
    await assert.rejects(
      db.exec("insert into public.itineraries (origin_airport_code, destination_airport_code) values ('BOS', 'BOS')"),
      /Airports must differ/
    );
  } finally { await db.close(); }
});

async function installDeployedTriggers(db) {
  await db.exec(await readMigration('010_itinerary_date_validation.sql'));
  // Exact legacy behavior supplied from the deployed database.
  await db.exec(`
    create or replace function public.sync_itineraries_destination_columns()
    returns trigger language plpgsql as $function$
    begin
      -- If only one side is provided/changed, mirror into the other side.
      if new.destination is null and new.destination_airport is not null then
        new.destination := new.destination_airport;
      elsif new.destination_airport is null and new.destination is not null then
        new.destination_airport := new.destination;
      elsif new.destination is distinct from new.destination_airport then
        -- Prefer explicit destination input when both differ.
        new.destination_airport := new.destination;
      end if;
      return new;
    end;
    $function$;
    create trigger trg_sync_itineraries_destination_columns
      before insert or update on public.itineraries
      for each row execute function public.sync_itineraries_destination_columns();
  `);
}

for (const alreadyRemoved of [false, true]) {
  test('publishing and editing work with deployed triggers: ' + (alreadyRemoved ? 'repair existing database' : 'fresh migration'), async () => {
    const db = await fixture();
    try {
      await installDeployedTriggers(db);
      const dateDefinition = (await db.query("select pg_get_functiondef('public.validate_itinerary_dates()'::regprocedure) as definition")).rows[0].definition;
      if (alreadyRemoved) {
        // Simulate the original 015, which did not know about the deployed trigger.
        await db.exec('drop view public.public_itinerary_search; alter table public.itineraries drop column destination');
        await assert.rejects(
          db.exec("insert into public.itineraries (origin_airport_code, destination_airport_code, start_date, end_date) values ('BOS', 'CDG', current_date, current_date + 1)"),
          /record "new" has no field "destination"/
        );
      } else {
        await db.exec(await readMigration('015_remove_optional_destination.sql'));
      }
      const repair = await readMigration('016_remove_legacy_destination_sync.sql');
      await db.exec(repair);
      await db.exec(repair);
      await db.exec(`insert into public.itineraries
        (origin_airport_code, destination_airport_code, origin_airport, destination_airport, start_date, end_date)
        values ('BOS', 'CDG', 'BOS', 'CDG', current_date, current_date + 1)`);
      await db.exec("update public.itineraries set destination_airport_code = 'SIN', destination_airport = 'SIN' where origin_airport_code = 'BOS'");
      const trip = (await db.query("select destination_airport, destination_airport_code from public.itineraries where origin_airport_code = 'BOS'")).rows[0];
      assert.deepEqual(trip, { destination_airport: 'SIN', destination_airport_code: 'SIN' });
      const triggers = (await db.query("select tgname, tgenabled from pg_trigger where tgrelid = 'public.itineraries'::regclass and not tgisinternal")).rows;
      assert.deepEqual(triggers, [{ tgname: 'itineraries_validate_dates', tgenabled: 'O' }]);
      assert.equal((await db.query("select pg_get_functiondef('public.validate_itinerary_dates()'::regprocedure) as definition")).rows[0].definition, dateDefinition);
      await assert.rejects(db.exec("update public.itineraries set start_date = current_date - 1"), /start_date cannot be in the past/);
      await assert.rejects(db.exec("update public.itineraries set end_date = current_date - 1"), /end_date cannot be in the past/);
      await assert.rejects(db.exec("update public.itineraries set start_date = current_date + 2, end_date = current_date + 1"), /end_date must be on or after start_date/);
    } finally { await db.close(); }
  });
}
