-- Backfill existing matching trips when a subscription becomes Premium.
begin;

-- Only trusted billing/admin code may grant paid entitlements. Signup still
-- provisions FREE subscriptions through its existing security-definer trigger.
drop policy if exists subscriptions_update_own on public.subscriptions;
drop policy if exists subscriptions_insert_own on public.subscriptions;
create policy subscriptions_insert_own
on public.subscriptions for insert to authenticated
with check (user_id = auth.uid() and plan_code = 'FREE' and status = 'ACTIVE');

create index if not exists itineraries_owner_match_idx
on public.itineraries (owner_id);

-- Internal entry point used by the trigger and trusted backend retries.
create or replace function public.backfill_premium_match_notifications(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted_count integer;
begin
  -- Keep the entitlement stable until inserts commit, including during retries.
  perform 1 from public.subscriptions s
  where s.user_id = p_user_id
    and upper(s.status) = 'ACTIVE'
    and upper(s.plan_code) <> 'FREE'
  for share;
  if not found then
    return 0;
  end if;

  insert into public.notifications (user_id, type, title, body, itinerary_id)
  select
    p_user_id,
    'AUTO_MATCH',
    'Matching trip available',
    format(
      'A %s -> %s trip overlaps your itinerary dates (%s to %s).',
      upper(coalesce(candidate.origin_airport_code, candidate.origin_airport)),
      upper(coalesce(candidate.destination_airport_code, candidate.destination_airport)),
      to_char(coalesce(candidate.start_date, candidate.depart_date), 'Mon DD, YYYY'),
      to_char(coalesce(candidate.end_date, candidate.return_date, candidate.depart_date), 'Mon DD, YYYY')
    ),
    candidate.id
  from public.itineraries candidate
  where candidate.owner_id <> p_user_id
    and coalesce(candidate.end_date, candidate.return_date, candidate.depart_date) >= current_date
    and exists (
      select 1 from public.itineraries own_trip
      where own_trip.owner_id = p_user_id
        and coalesce(own_trip.end_date, own_trip.return_date, own_trip.depart_date) >= current_date
        and upper(coalesce(own_trip.origin_airport_code, own_trip.origin_airport)) =
            upper(coalesce(candidate.origin_airport_code, candidate.origin_airport))
        and upper(coalesce(own_trip.destination_airport_code, own_trip.destination_airport)) =
            upper(coalesce(candidate.destination_airport_code, candidate.destination_airport))
        -- Require overlap today or later, not just overlap in the past.
        and greatest(coalesce(own_trip.start_date, own_trip.depart_date),
                     coalesce(candidate.start_date, candidate.depart_date), current_date) <=
            least(coalesce(own_trip.end_date, own_trip.return_date, own_trip.depart_date),
                  coalesce(candidate.end_date, candidate.return_date, candidate.depart_date))
        and (
          not exists (
            select 1 from public.itinerary_legs leg
            where leg.itinerary_id = candidate.id and leg.leg_order > 1
          )
          or not exists (
            select 1 from public.itinerary_legs leg
            where leg.itinerary_id = own_trip.id and leg.leg_order > 1
          )
          or exists (
            select 1 from public.itinerary_legs candidate_leg
            join public.itinerary_legs own_leg
              on own_leg.itinerary_id = own_trip.id
             and own_leg.leg_order = candidate_leg.leg_order
            where candidate_leg.itinerary_id = candidate.id
              and candidate_leg.leg_order > 1
              and upper(coalesce(own_leg.origin_airport_code, own_leg.origin_airport)) =
                  upper(coalesce(candidate_leg.origin_airport_code, candidate_leg.origin_airport))
              and upper(coalesce(own_leg.destination_airport_code, own_leg.destination_airport)) =
                  upper(coalesce(candidate_leg.destination_airport_code, candidate_leg.destination_airport))
          )
        )
    )
  on conflict (user_id, type, itinerary_id)
    where type = 'AUTO_MATCH' and itinerary_id is not null
  do nothing;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$$;

revoke all on function public.backfill_premium_match_notifications(uuid) from public, anon, authenticated;
grant execute on function public.backfill_premium_match_notifications(uuid) to service_role;

-- A signed-in user can retry only their own backfill; the helper checks Premium.
create or replace function public.create_premium_backfill_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return public.backfill_premium_match_notifications(auth.uid());
end;
$$;

revoke all on function public.create_premium_backfill_notifications() from public, anon;
grant execute on function public.create_premium_backfill_notifications() to authenticated;

create or replace function public.notify_on_premium_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(new.status) <> 'ACTIVE' or upper(new.plan_code) = 'FREE' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if upper(old.status) = 'ACTIVE' and upper(old.plan_code) <> 'FREE' then
      return new;
    end if;
  end if;

  begin
    perform public.backfill_premium_match_notifications(new.user_id);
  exception when others then
    -- Roll back only notification work; keep the subscription activation.
    raise warning 'Premium match backfill failed for user % (SQLSTATE %). Retry backfill_premium_match_notifications.',
      new.user_id, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_on_premium_activation() from public, anon, authenticated;
drop trigger if exists on_premium_subscription_activation on public.subscriptions;
create trigger on_premium_subscription_activation
after insert or update of plan_code, status on public.subscriptions
for each row execute function public.notify_on_premium_activation();

commit;
