-- Run AFTER 017 in the Supabase SQL Editor as postgres. Never ship a privileged
-- key to the browser. Replace only the email below with an existing account.
begin;
do $$
declare
  v_email text := 'replace-with-admin@example.com';
  v_user uuid;
begin
  select id into strict v_user from auth.users where lower(email) = lower(btrim(v_email));
  insert into public.app_admins(user_id) values(v_user) on conflict do nothing;
end;
$$;
commit;

-- Revoke, if needed, using a trusted SQL session (also audited):
-- delete from public.app_admins where user_id = 'USER_UUID_HERE'::uuid;
