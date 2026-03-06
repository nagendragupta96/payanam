-- Deprecate itinerary_legs.carrier and rely on normalized flight_number/flight_code.

-- Step 1: Merge legacy carrier+flight_number into a single normalized flight_number.
update public.itinerary_legs
set flight_number = upper(
  regexp_replace(
    coalesce(
      case
        when coalesce(trim(carrier), '') = '' then coalesce(flight_number, '')
        when upper(regexp_replace(coalesce(flight_number, ''), '\\s+', '', 'g')) like upper(regexp_replace(coalesce(carrier, ''), '\\s+', '', 'g')) || '%'
          then coalesce(flight_number, '')
        else coalesce(carrier, '') || coalesce(flight_number, '')
      end,
      ''
    ),
    '\\s+',
    '',
    'g'
  )
)
where carrier is not null or flight_number is not null;

-- Step 2: Drop carrier with CASCADE to remove dependent objects (generated flight_code/views).
alter table public.itinerary_legs
  drop column if exists carrier cascade;

-- Step 3: Ensure flight_code exists and is aligned with normalized flight_number.
do $$
declare
  v_is_generated text;
begin
  select c.is_generated
  into v_is_generated
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'itinerary_legs'
    and c.column_name = 'flight_code';

  if v_is_generated is null then
    execute $sql$
      alter table public.itinerary_legs
      add column flight_code text generated always as (
        upper(regexp_replace(coalesce(flight_number, ''), '\\s+', '', 'g'))
      ) stored
    $sql$;
  elsif v_is_generated = 'NEVER' then
    update public.itinerary_legs
    set flight_code = upper(regexp_replace(coalesce(flight_number, ''), '\\s+', '', 'g'))
    where flight_number is not null;
  end if;
end
$$;

create or replace view public.public_itinerary_search with (security_invoker = off) as
select
  i.id,
  i.owner_id,
  coalesce(i.origin_airport_code, upper(i.origin_airport)) as origin_airport_code,
  coalesce(i.destination_airport_code, upper(i.destination_airport)) as destination_airport_code,
  i.destination,
  coalesce(i.start_date, i.depart_date) as start_date,
  coalesce(i.end_date, i.return_date, i.depart_date) as end_date,
  exists (
    select 1
    from public.itinerary_contact_details icd
    where icd.itinerary_id = i.id
  ) as has_contact_details,
  i.created_at,
  coalesce(
    json_agg(
      json_build_object(
        'leg_order', l.leg_order,
        'origin_airport_code', coalesce(l.origin_airport_code, upper(l.origin_airport)),
        'destination_airport_code', coalesce(l.destination_airport_code, upper(l.destination_airport)),
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
where coalesce(i.end_date, i.return_date, i.depart_date) >= current_date
group by i.id;

alter view public.public_itinerary_search set (security_invoker = off);
grant select on public.public_itinerary_search to anon, authenticated;
