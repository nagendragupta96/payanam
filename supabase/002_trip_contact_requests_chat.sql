-- Trip contact details + request/chat hardening + public search view

-- 1) Requests enhancements
alter table public.requests
  add column if not exists request_type text;

alter table public.requests
  drop constraint if exists requests_request_type_check;

alter table public.requests
  add constraint requests_request_type_check
  check (request_type is null or request_type in ('COMPANION', 'ASSISTANCE'));

create index if not exists requests_itinerary_status_idx on public.requests (itinerary_id, status);
create index if not exists requests_owner_status_idx on public.requests (owner_id, status);

-- 2) Contact details per itinerary (owner managed)
create table if not exists public.itinerary_contact_details (
  itinerary_id uuid primary key references public.itineraries(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_name text,
  contact_phone text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists itinerary_contact_owner_idx on public.itinerary_contact_details(owner_id);

alter table public.itinerary_contact_details enable row level security;

drop policy if exists icd_owner_select on public.itinerary_contact_details;
drop policy if exists icd_owner_insert on public.itinerary_contact_details;
drop policy if exists icd_owner_update on public.itinerary_contact_details;
drop policy if exists icd_requester_select_when_accepted on public.itinerary_contact_details;

create policy icd_owner_select
on public.itinerary_contact_details
for select
to authenticated
using (owner_id = auth.uid());

create policy icd_owner_insert
on public.itinerary_contact_details
for insert
to authenticated
with check (owner_id = auth.uid());

create policy icd_owner_update
on public.itinerary_contact_details
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy icd_requester_select_when_accepted
on public.itinerary_contact_details
for select
to authenticated
using (
  exists (
    select 1
    from public.requests r
    where r.itinerary_id = itinerary_contact_details.itinerary_id
      and r.owner_id = itinerary_contact_details.owner_id
      and r.requester_id = auth.uid()
      and r.status = 'ACCEPTED'
  )
);

-- 3) RPC for accept + thread creation (single transaction)
create or replace function public.accept_request_and_create_thread(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests%rowtype;
  v_thread_id uuid;
begin
  select * into v_request
  from public.requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Request not found';
  end if;

  if v_request.owner_id <> auth.uid() then
    raise exception 'Not authorized to accept this request';
  end if;

  update public.requests
  set status = 'ACCEPTED', updated_at = now()
  where id = p_request_id;

  select id into v_thread_id
  from public.chat_threads
  where request_id = p_request_id;

  if v_thread_id is null then
    insert into public.chat_threads (request_id, itinerary_id, owner_id, requester_id)
    values (v_request.id, v_request.itinerary_id, v_request.owner_id, v_request.requester_id)
    returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$$;

grant execute on function public.accept_request_and_create_thread(uuid) to authenticated;

-- 4) Public search view (safe fields only)
create or replace view public.public_itinerary_search as
select
  i.id,
  i.owner_id,
  i.origin_airport,
  i.destination_airport,
  i.destination,
  i.depart_date,
  i.return_date,
  i.created_at,
  coalesce(
    json_agg(
      json_build_object(
        'leg_order', l.leg_order,
        'origin_airport', l.origin_airport,
        'destination_airport', l.destination_airport,
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

grant select on public.public_itinerary_search to anon, authenticated;
