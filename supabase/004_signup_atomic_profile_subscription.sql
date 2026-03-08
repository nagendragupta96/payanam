-- Signup consistency hardening
--
-- Why this exists:
-- Auth user creation is handled by Supabase Auth and cannot be rolled back by client code
-- if later client-side profile insertion fails. So we provision profile/subscription server-side
-- in an auth.users trigger to keep state consistent.

-- Ensure profile RLS policies allow authenticated users to insert/update/select only themselves.
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Minimal subscriptions table used for default FREE plan provisioning.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null default 'FREE',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_select_own on public.subscriptions;
drop policy if exists subscriptions_insert_own on public.subscriptions;
drop policy if exists subscriptions_update_own on public.subscriptions;

create policy subscriptions_select_own
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

create policy subscriptions_insert_own
on public.subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

create policy subscriptions_update_own
on public.subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  insert into public.subscriptions (user_id, plan_code, status)
  values (new.id, 'FREE', 'ACTIVE')
  on conflict (user_id) do update
    set plan_code = excluded.plan_code,
        status = excluded.status,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();
