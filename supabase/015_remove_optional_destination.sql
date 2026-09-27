-- Remove the optional free-text destination, keeping airport routing intact.
begin;

-- RESTRICT is intentional: unknown dependent objects must not be deleted.
drop view if exists public.public_itinerary_search;
alter table public.itineraries drop column if exists destination;

-- Expose a safe boolean in public search to indicate whether contact details exist.
-- This does NOT expose the actual contact details data.

create or replace view public.public_itinerary_search with (security_invoker = off) as
select
  i.id,
  i.owner_id,
  coalesce(i.origin_airport_code, upper(i.origin_airport)) as origin_airport_code,
  coalesce(i.destination_airport_code, upper(i.destination_airport)) as destination_airport_code,
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
  ) as legs,
  exists (
    select 1
    from public.itinerary_contact_details icd
    where icd.itinerary_id = i.id
      and (
        nullif(trim(icd.contact_name), '') is not null or
        nullif(trim(icd.contact_phone), '') is not null or
        nullif(trim(icd.contact_email), '') is not null or
        nullif(trim(icd.notes), '') is not null
      )
  ) as has_contact_details
from public.itineraries i
left join public.itinerary_legs l on l.itinerary_id = i.id
group by i.id;

alter view public.public_itinerary_search set (security_invoker = off);

grant select on public.public_itinerary_search to anon, authenticated;


commit;
