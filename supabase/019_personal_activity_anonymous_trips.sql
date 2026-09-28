-- Apply after 018. Personal history is read-only; anonymity applies to browsing.
begin;

create or replace function public.my_activity(
  p_before bigint default null, p_limit integer default 25, p_category text default 'all'
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; v_user uuid := auth.uid();
begin
  if not exists(select 1 from auth.users where id = v_user) then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or p_category is null or p_category not in ('all', 'actions', 'notifications')
    or (p_before is not null and p_before < 1) then
    raise exception 'Invalid activity filters.';
  end if;
  with matching as (
    select e.* from public.activity_events e
    where (e.actor_id = v_user or e.subject_user_id = v_user)
      and (p_before is null or e.id < p_before)
      and (p_category = 'all'
        or (p_category = 'notifications' and e.action in ('notifications.insert', 'notifications.update', 'notifications.delete', 'notification.available'))
        or (p_category = 'actions' and e.action not in ('notifications.insert', 'notifications.update', 'notifications.delete', 'notification.available')))
    order by e.id desc limit p_limit + 1
  ), page as (
    select id, created_at, source, action, entity_type,
      coalesce(actor_id = v_user, false) as performed_by_you,
      coalesce(subject_user_id = v_user, false) as affects_you,
      jsonb_strip_nulls(jsonb_build_object(
        'area', details->'area', 'control', details->'control',
        'status', details->'status', 'notification_type', details->'notification_type',
        'is_read', details->'is_read')) as details
    from matching order by id desc limit p_limit
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by id desc) from page), '[]'::jsonb),
    'has_more', (select count(*) > p_limit from matching)) into result;
  return result;
end;
$$;
revoke all on function public.my_activity(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.my_activity(bigint, integer, text) to authenticated;

alter table public.itineraries add column if not exists is_anonymous boolean not null default false;

-- Constrain pre-existing permissive policies. Participants retain the existing
-- identity-sharing behavior after a request; the public view remains redacted.
create or replace function public.is_itinerary_participant(p_itinerary uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.requests r where r.itinerary_id = p_itinerary
    and (r.owner_id = auth.uid() or r.requester_id = auth.uid()));
$$;
revoke all on function public.is_itinerary_participant(uuid) from public, anon, authenticated;
grant execute on function public.is_itinerary_participant(uuid) to anon, authenticated;
alter table public.itineraries enable row level security;
drop policy if exists anonymous_itinerary_read on public.itineraries;
create policy anonymous_itinerary_read on public.itineraries as restrictive for select to anon, authenticated
using (not is_anonymous or owner_id = auth.uid() or public.is_itinerary_participant(id));

-- Preserve existing columns/grants and downstream dependencies.
create or replace view public.public_itinerary_search with (security_invoker = off) as
select i.id,
  case when i.is_anonymous and i.owner_id is distinct from auth.uid() then null else i.owner_id end as owner_id,
  coalesce(i.origin_airport_code, upper(i.origin_airport)) as origin_airport_code,
  coalesce(i.destination_airport_code, upper(i.destination_airport)) as destination_airport_code,
  coalesce(i.start_date, i.depart_date) as start_date,
  coalesce(i.end_date, i.return_date, i.depart_date) as end_date,
  i.created_at, i.languages_known,
  coalesce(json_agg(json_build_object(
    'leg_order', l.leg_order,
    'origin_airport_code', coalesce(l.origin_airport_code, upper(l.origin_airport)),
    'destination_airport_code', coalesce(l.destination_airport_code, upper(l.destination_airport)),
    'flight_number', l.flight_number, 'flight_code', l.flight_code,
    'departure_at', l.departure_at, 'arrival_at', l.arrival_at
  ) order by l.leg_order) filter (where l.id is not null), '[]'::json) as legs,
  exists(select 1 from public.itinerary_contact_details c where c.itinerary_id = i.id
    and (nullif(trim(c.contact_name), '') is not null or nullif(trim(c.contact_phone), '') is not null
      or nullif(trim(c.contact_email), '') is not null or nullif(trim(c.notes), '') is not null)) as has_contact_details,
  i.is_anonymous,
  case when i.is_anonymous then 'Anonymous' else coalesce(nullif(trim(p.display_name), ''), 'Traveler') end as posted_by
from public.itineraries i
left join public.itinerary_legs l on l.itinerary_id = i.id
left join public.profiles p on p.id = i.owner_id
group by i.id, p.display_name;
grant select on public.public_itinerary_search to anon, authenticated;

-- Resolve ownership server-side without exposing it during anonymous browsing.
create or replace function public.create_itinerary_request(p_itinerary uuid, p_type text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_request public.requests;
begin
  if not exists(select 1 from auth.users where id = v_user) then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('COMPANION', 'ASSISTANCE', 'CONTACT_DETAILS') then
    raise exception 'Invalid request type.';
  end if;
  select owner_id into v_owner from public.itineraries where id = p_itinerary for update;
  if not found then raise exception 'Trip not found.'; end if;
  if v_owner = v_user then raise exception 'You cannot send a request for your own trip.'; end if;
  select * into v_request from public.requests where itinerary_id = p_itinerary
    and requester_id = v_user and owner_id = v_owner and request_type = p_type
    and status in ('PENDING', 'ACCEPTED') order by created_at desc limit 1;
  if found then return jsonb_build_object('data', to_jsonb(v_request), 'existing', true); end if;
  insert into public.requests(itinerary_id, requester_id, owner_id, request_type, status, message)
    values(p_itinerary, v_user, v_owner, p_type, 'PENDING', p_message) returning * into v_request;
  return jsonb_build_object('data', to_jsonb(v_request), 'existing', false);
end;
$$;
revoke all on function public.create_itinerary_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_itinerary_request(uuid, text, text) to authenticated;
commit;
