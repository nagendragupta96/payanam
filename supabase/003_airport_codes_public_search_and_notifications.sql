-- Airport code normalization + safer public search + non-blocking notification support

alter table public.itineraries
  add column if not exists origin_airport_code text,
  add column if not exists destination_airport_code text,
  add column if not exists start_date date,
  add column if not exists end_date date;

update public.itineraries
set
  origin_airport_code = coalesce(origin_airport_code, upper(origin_airport)),
  destination_airport_code = coalesce(destination_airport_code, upper(destination_airport)),
  start_date = coalesce(start_date, depart_date),
  end_date = coalesce(end_date, return_date, depart_date)
where true;

alter table public.itinerary_legs
  add column if not exists origin_airport_code text,
  add column if not exists destination_airport_code text;

update public.itinerary_legs
set
  origin_airport_code = coalesce(origin_airport_code, upper(origin_airport)),
  destination_airport_code = coalesce(destination_airport_code, upper(destination_airport))
where true;

create index if not exists itineraries_origin_dest_dates_idx
  on public.itineraries (origin_airport_code, destination_airport_code, start_date, end_date);


-- If `public_itinerary_search` already exists with legacy column names,
-- rename columns first so CREATE OR REPLACE can succeed without 42P16.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_itinerary_search'
      and column_name = 'origin_airport'
  ) then
    execute 'alter view public.public_itinerary_search rename column origin_airport to origin_airport_code';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_itinerary_search'
      and column_name = 'destination_airport'
  ) then
    execute 'alter view public.public_itinerary_search rename column destination_airport to destination_airport_code';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_itinerary_search'
      and column_name = 'depart_date'
  ) then
    execute 'alter view public.public_itinerary_search rename column depart_date to start_date';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_itinerary_search'
      and column_name = 'return_date'
  ) then
    execute 'alter view public.public_itinerary_search rename column return_date to end_date';
  end if;
end $$;

-- Keep SECURITY INVOKER off for this public-safe projection view.
-- Search is used by anon users and underlying itinerary tables are protected by RLS,
-- so SECURITY INVOKER would require broad table grants/policies and break search.
create or replace view public.public_itinerary_search with (security_invoker = off) as
select
  i.id,
  i.owner_id,
  coalesce(i.origin_airport_code, upper(i.origin_airport)) as origin_airport_code,
  coalesce(i.destination_airport_code, upper(i.destination_airport)) as destination_airport_code,
  i.destination,
  coalesce(i.start_date, i.depart_date) as start_date,
  coalesce(i.end_date, i.return_date, i.depart_date) as end_date,
  i.created_at,
  coalesce(
    json_agg(
      json_build_object(
        'leg_order', l.leg_order,
        'origin_airport_code', coalesce(l.origin_airport_code, upper(l.origin_airport)),
        'destination_airport_code', coalesce(l.destination_airport_code, upper(l.destination_airport)),
        'carrier', l.carrier,
        'flight_number', l.flight_number,
        'flight_code', l.flight_code,
        'departure_at', l.departure_at,
        'arrival_at', l.arrival_at
      ) order by l.leg_order
    ) filter (where l.id is not null),
    '[]'::json
  ) as legs
from public.itineraries i
left join public.itinerary_legs l on l.itinerary_id = i.id
group by i.id;

alter view public.public_itinerary_search set (security_invoker = off);

grant select on public.public_itinerary_search to anon, authenticated;

-- Optional edge function expected by frontend for match notifications.
-- Frontend calls this non-blocking after trip save.
