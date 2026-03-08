-- Harden signup trigger to avoid 500/unexpected_failure from optional provisioning paths.
--
-- The auth.users insert + trigger runs in one DB transaction inside GoTrue.
-- If this function raises, /auth/v1/signup returns 500.
--
-- Strategy:
-- 1) Profile provisioning is required and must succeed.
-- 2) Subscription provisioning is best-effort and should not break signup if
--    environments have a different subscriptions schema.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Required: must exist for application consistency.
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  -- Optional: best effort only.
  begin
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'subscriptions'
        and column_name = 'user_id'
    ) then
      insert into public.subscriptions (user_id, plan_code, status)
      values (new.id, 'FREE', 'ACTIVE')
      on conflict (user_id) do update
        set plan_code = excluded.plan_code,
            status = excluded.status,
            updated_at = now();
    end if;
  exception
    when undefined_table or undefined_column then
      -- Ignore incompatible/missing subscriptions schema to prevent signup 500.
      null;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();
