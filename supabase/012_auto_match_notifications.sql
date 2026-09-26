-- Premium auto-match notifications.
--
-- Notifications are readable/updatable only by their owner. Creation for auto
-- matches is handled by a security-definer RPC so itinerary saves can notify
-- other premium users without relaxing table RLS.

create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  itinerary_id uuid references public.itineraries(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create index if not exists notifications_user_created_idx
on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
on public.notifications (user_id, is_read)
where is_read = false;

create unique index if not exists notifications_auto_match_unique_idx
on public.notifications (user_id, type, itinerary_id)
where type = 'AUTO_MATCH' and itinerary_id is not null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when undefined_object then
    null;
end;
$$;

drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_insert_own on public.notifications;

create policy notifications_select_own
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

create policy notifications_update_own
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Allows future self-service notification preferences/manual notices without
-- permitting users to write notifications for other accounts.
create policy notifications_insert_own
on public.notifications
for insert
to authenticated
with check (user_id = auth.uid());

-- Existing databases use plan; migration 004 creates plan_code on new installs.
-- Prefer plan when present, even if NULL, so stale alternate values cannot grant access.
create or replace function public.notification_subscription_plan(p_subscription jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select upper(nullif(btrim(
    case when p_subscription ? 'plan' then p_subscription ->> 'plan'
         else p_subscription ->> 'plan_code' end
  ), ''));
$$;

revoke all on function public.notification_subscription_plan(jsonb) from public, anon;
grant execute on function public.notification_subscription_plan(jsonb) to authenticated, service_role;

create or replace function public.create_auto_match_notifications(p_itinerary_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_itinerary record;
  v_inserted_count integer := 0;
begin
  select
    i.id,
    i.owner_id,
    upper(coalesce(i.origin_airport_code, i.origin_airport)) as origin_airport_code,
    upper(coalesce(i.destination_airport_code, i.destination_airport)) as destination_airport_code,
    coalesce(i.start_date, i.depart_date) as start_date,
    coalesce(i.end_date, i.return_date, i.depart_date) as end_date
  into v_itinerary
  from public.itineraries i
  where i.id = p_itinerary_id;

  if v_itinerary.id is null then
    return 0;
  end if;

  if v_itinerary.owner_id <> auth.uid() then
    raise exception 'Not authorized to create match notifications for this itinerary';
  end if;

  with matching_premium_users as (
    select distinct existing.owner_id as user_id
    from public.itineraries existing
    join public.subscriptions s
      on s.user_id = existing.owner_id
    where existing.owner_id <> v_itinerary.owner_id
      and upper(s.status) = 'ACTIVE'
      and public.notification_subscription_plan(to_jsonb(s)) <> 'FREE'
      and upper(coalesce(existing.origin_airport_code, existing.origin_airport)) = v_itinerary.origin_airport_code
      and upper(coalesce(existing.destination_airport_code, existing.destination_airport)) = v_itinerary.destination_airport_code
      and coalesce(existing.start_date, existing.depart_date) <= v_itinerary.end_date
      and coalesce(existing.end_date, existing.return_date, existing.depart_date) >= v_itinerary.start_date
      and (
        not exists (
          select 1
          from public.itinerary_legs new_leg
          where new_leg.itinerary_id = v_itinerary.id
            and new_leg.leg_order > 1
        )
        or not exists (
          select 1
          from public.itinerary_legs existing_leg
          where existing_leg.itinerary_id = existing.id
            and existing_leg.leg_order > 1
        )
        or exists (
          select 1
          from public.itinerary_legs new_leg
          join public.itinerary_legs existing_leg
            on existing_leg.itinerary_id = existing.id
           and existing_leg.leg_order = new_leg.leg_order
          where new_leg.itinerary_id = v_itinerary.id
            and new_leg.leg_order > 1
            and upper(coalesce(existing_leg.origin_airport_code, existing_leg.origin_airport)) =
                upper(coalesce(new_leg.origin_airport_code, new_leg.origin_airport))
            and upper(coalesce(existing_leg.destination_airport_code, existing_leg.destination_airport)) =
                upper(coalesce(new_leg.destination_airport_code, new_leg.destination_airport))
        )
      )
  )
  insert into public.notifications (user_id, type, title, body, itinerary_id)
  select
    user_id,
    'AUTO_MATCH',
    'New matching trip posted',
    format(
      'A new %s -> %s trip overlaps your itinerary dates (%s to %s).',
      v_itinerary.origin_airport_code,
      v_itinerary.destination_airport_code,
      to_char(v_itinerary.start_date, 'Mon DD, YYYY'),
      to_char(v_itinerary.end_date, 'Mon DD, YYYY')
    ),
    v_itinerary.id
  from matching_premium_users m
  where not exists (
    select 1
    from public.notifications n
    where n.user_id = m.user_id
      and n.type = 'AUTO_MATCH'
      and n.itinerary_id = v_itinerary.id
  );

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$$;

grant execute on function public.create_auto_match_notifications(uuid) to authenticated;
