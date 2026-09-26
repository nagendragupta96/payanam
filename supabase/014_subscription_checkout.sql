-- Demo checkout. Disable mock_enabled before connecting a real payment provider.
begin;

alter table public.subscriptions
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz;

create table if not exists public.subscription_billing_settings (
  id boolean primary key default true check (id),
  mock_enabled boolean not null default true
);
insert into public.subscription_billing_settings (id) values (true) on conflict do nothing;
alter table public.subscription_billing_settings enable row level security;
revoke all on public.subscription_billing_settings from anon, authenticated;
grant all on public.subscription_billing_settings to service_role;

create table if not exists public.subscription_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null check (plan_code = 'PREMIUM'),
  provider text not null,
  provider_reference text,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  completed_at timestamptz
);
create index if not exists subscription_checkouts_user_idx
  on public.subscription_checkouts (user_id, created_at desc);
create unique index if not exists subscription_checkouts_provider_reference_idx
  on public.subscription_checkouts (provider, provider_reference)
  where provider_reference is not null;
alter table public.subscription_checkouts enable row level security;
revoke all on public.subscription_checkouts from anon, authenticated;
grant select on public.subscription_checkouts to authenticated;
grant all on public.subscription_checkouts to service_role;
drop policy if exists subscription_checkouts_select_own on public.subscription_checkouts;
create policy subscription_checkouts_select_own on public.subscription_checkouts
  for select to authenticated using (user_id = auth.uid());

create or replace function public.get_my_subscription()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_subscription jsonb;
  v_premium boolean;
  v_mock_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to manage your subscription.' using errcode = '42501';
  end if;
  -- Match the existing notification entitlement rules, including legacy plans.
  select to_jsonb(s) into v_subscription from public.subscriptions s
  where s.user_id = auth.uid()
  order by (upper(s.status) = 'ACTIVE' and public.notification_subscription_plan(to_jsonb(s)) <> 'FREE') desc nulls last,
    s.created_at desc
  limit 1;
  v_premium := coalesce(upper(v_subscription ->> 'status') = 'ACTIVE'
    and public.notification_subscription_plan(v_subscription) <> 'FREE', false);
  select mock_enabled into v_mock_enabled from public.subscription_billing_settings where id;
  return jsonb_build_object(
    'plan_code', case when v_premium then public.notification_subscription_plan(v_subscription) else 'FREE' end,
    'status', coalesce(v_subscription ->> 'status', 'ACTIVE'),
    'is_premium', v_premium,
    'mock_enabled', coalesce(v_mock_enabled, false)
  );
end;
$$;

create or replace function public.create_subscription_checkout()
returns public.subscription_checkouts language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout public.subscription_checkouts;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to subscribe.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 14));
  if not coalesce((select mock_enabled from public.subscription_billing_settings where id), false) then
    raise exception 'Demo checkout is currently unavailable.';
  end if;
  if (public.get_my_subscription() ->> 'is_premium')::boolean then
    raise exception 'Premium is already active on your account.';
  end if;
  select * into v_checkout from public.subscription_checkouts
  where user_id = auth.uid() and provider = 'mock' and status = 'PENDING' and expires_at > now()
  order by created_at desc limit 1;
  if found then return v_checkout; end if;
  insert into public.subscription_checkouts (user_id, plan_code, provider)
  values (auth.uid(), 'PREMIUM', 'mock') returning * into v_checkout;
  return v_checkout;
end;
$$;

-- Future payment webhooks call this only AFTER verifying the provider's payment.
-- The browser cannot choose a user, plan, reference, or fulfill real payments.
create or replace function public.fulfill_subscription_checkout(
  p_checkout_id uuid, p_provider text, p_reference text
)
returns public.subscription_checkouts language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout public.subscription_checkouts;
  v_row tid;
  v_plan_column text;
begin
  select * into v_checkout from public.subscription_checkouts where id = p_checkout_id;
  if not found then raise exception 'Checkout not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_checkout.user_id::text, 14));
  select * into v_checkout from public.subscription_checkouts where id = p_checkout_id for update;
  if v_checkout.provider is distinct from p_provider or nullif(btrim(p_reference), '') is null then
    raise exception 'Invalid payment confirmation.';
  end if;
  if v_checkout.status = 'COMPLETED' then
    if v_checkout.provider_reference is distinct from p_reference then
      raise exception 'Payment reference does not match.';
    end if;
    return v_checkout;
  end if;
  if v_checkout.status <> 'PENDING' then raise exception 'This checkout was cancelled.'; end if;
  if v_checkout.expires_at <= now() then raise exception 'This checkout has expired. Start a new checkout.'; end if;

  select case when exists (
    select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'subscriptions' and column_name = 'plan'
  ) then 'plan' else 'plan_code' end into v_plan_column;

  -- Keep historical rows intact. Update the newest current record, if present.
  select s.ctid into v_row from public.subscriptions s
    where s.user_id = v_checkout.user_id order by s.created_at desc limit 1 for update;
  if found then
    execute format('update public.subscriptions set %I = $1, status = $2,
      period_start = now(), period_end = null, updated_at = now() where ctid = $3', v_plan_column)
      using v_checkout.plan_code, 'ACTIVE', v_row;
  else
    execute format('insert into public.subscriptions (user_id, %I, status, period_start)
      values ($1, $2, $3, now())', v_plan_column)
      using v_checkout.user_id, v_checkout.plan_code, 'ACTIVE';
  end if;

  update public.subscription_checkouts set status = 'COMPLETED',
    provider_reference = p_reference, completed_at = now()
    where id = p_checkout_id returning * into v_checkout;
  return v_checkout;
end;
$$;

create or replace function public.complete_mock_subscription_checkout(p_checkout_id uuid)
returns public.subscription_checkouts language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in to continue.' using errcode = '42501'; end if;
  if not coalesce((select mock_enabled from public.subscription_billing_settings where id), false) then
    raise exception 'Demo checkout is currently unavailable.';
  end if;
  if not exists (select 1 from public.subscription_checkouts
    where id = p_checkout_id and user_id = auth.uid() and provider = 'mock') then
    raise exception 'Checkout not found.' using errcode = '42501';
  end if;
  return public.fulfill_subscription_checkout(p_checkout_id, 'mock', 'mock:' || p_checkout_id::text);
end;
$$;

create or replace function public.cancel_subscription_checkout(p_checkout_id uuid)
returns public.subscription_checkouts language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout public.subscription_checkouts;
begin
  if auth.uid() is null then raise exception 'Please sign in to continue.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 14));
  select * into v_checkout from public.subscription_checkouts
    where id = p_checkout_id and user_id = auth.uid() for update;
  if not found then raise exception 'Checkout not found.' using errcode = '42501'; end if;
  if v_checkout.status = 'COMPLETED' then raise exception 'This checkout is already completed.'; end if;
  update public.subscription_checkouts set status = 'CANCELLED'
    where id = p_checkout_id returning * into v_checkout;
  return v_checkout;
end;
$$;

revoke all on function public.get_my_subscription() from public, anon, authenticated;
revoke all on function public.create_subscription_checkout() from public, anon, authenticated;
revoke all on function public.complete_mock_subscription_checkout(uuid) from public, anon, authenticated;
revoke all on function public.cancel_subscription_checkout(uuid) from public, anon, authenticated;
revoke all on function public.fulfill_subscription_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_my_subscription() to authenticated;
grant execute on function public.create_subscription_checkout() to authenticated;
grant execute on function public.complete_mock_subscription_checkout(uuid) to authenticated;
grant execute on function public.cancel_subscription_checkout(uuid) to authenticated;
grant execute on function public.fulfill_subscription_checkout(uuid, text, text) to service_role;
commit;
