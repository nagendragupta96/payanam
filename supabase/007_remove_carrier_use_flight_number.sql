-- Deprecate itinerary_legs.carrier and rely on normalized flight_number/flight_code.

update public.itinerary_legs
set
  flight_number = upper(regexp_replace(coalesce(flight_number, ''), '\\s+', '', 'g')),
  flight_code = upper(regexp_replace(coalesce(flight_number, ''), '\\s+', '', 'g'))
where flight_number is not null;

alter table public.itinerary_legs
  drop column if exists carrier;

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
