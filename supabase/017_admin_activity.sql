-- Apply after 016. Roles are granted only by a trusted SQL operator.
begin;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from public, anon, authenticated;

-- Deliberately no user/post foreign keys: history survives deletion.
create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_is_admin boolean not null default false,
  source text not null check (source in ('database', 'admin', 'client')),
  action text not null,
  entity_type text,
  entity_id text,
  subject_user_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index if not exists activity_events_time_idx on public.activity_events(created_at desc, id desc);
create index if not exists activity_events_actor_idx on public.activity_events(actor_id, created_at desc);
create index if not exists activity_events_subject_idx on public.activity_events(subject_user_id, created_at desc);
create index if not exists activity_events_source_idx on public.activity_events(source, created_at desc);
alter table public.activity_events enable row level security;
revoke all on public.activity_events from public, anon, authenticated;
revoke all on sequence public.activity_events_id_seq from public, anon, authenticated;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid());
$$;

create or replace function public.require_app_admin()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.audit_app_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  previous jsonb;
  subject_id uuid;
  recipient_id uuid;
  changed jsonb := '[]'::jsonb;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    previous := to_jsonb(old);
    if r = previous then return new; end if;
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into changed
    from jsonb_each(r) where value is distinct from previous -> key;
  end if;
  subject_id := coalesce(r->>'user_id', r->>'sender_id', r->>'owner_id',
    case when tg_table_name in ('users', 'profiles') then r->>'id' end)::uuid;
  insert into public.activity_events(actor_id, actor_is_admin, source, action, entity_type, entity_id, subject_user_id, details)
  values (auth.uid(), public.is_app_admin(), 'database', tg_table_name || '.' || lower(tg_op),
    tg_table_name, coalesce(r->>'id', r->>'itinerary_id', r->>'user_id'), subject_id,
    jsonb_strip_nulls(jsonb_build_object('changed_fields', changed,
      'status', r->>'status', 'previous_status', previous->>'status',
      'notification_type', case when tg_table_name = 'notifications' then r->>'type' end,
      'is_read', case when tg_table_name = 'notifications' then r->'is_read' end)));
  -- These two badges derive from records, not persisted notifications. Record
  -- eligibility separately; this is NOT a delivery/read receipt.
  if tg_op = 'INSERT' and tg_table_name = 'requests' then
    recipient_id := (r->>'owner_id')::uuid;
  elsif tg_op = 'INSERT' and tg_table_name = 'chat_messages' then
    select case when t.owner_id = (r->>'sender_id')::uuid then t.requester_id else t.owner_id end
    into recipient_id from public.chat_threads t where t.id = (r->>'thread_id')::uuid;
  end if;
  if recipient_id is not null then
    insert into public.activity_events(actor_id, actor_is_admin, source, action, entity_type, entity_id, subject_user_id)
    values (auth.uid(), public.is_app_admin(), 'database', 'notification.available', tg_table_name, r->>'id', recipient_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'itineraries', 'itinerary_legs', 'itinerary_contact_details',
    'requests', 'chat_threads', 'chat_messages', 'subscriptions', 'subscription_checkouts', 'notifications', 'app_admins'] loop
    execute format('drop trigger if exists audit_app_change on public.%I', t);
    execute format('create trigger audit_app_change after insert or update or delete on public.%I
      for each row execute function public.audit_app_change()', t);
  end loop;
end;
$$;
drop trigger if exists audit_app_change on auth.users;
create trigger audit_app_change after insert or update or delete on auth.users
  for each row execute function public.audit_app_change();
-- Sessions identify server-confirmed sign-ins/sign-outs. Older test schemas may
-- omit auth.sessions; production Supabase supplies it.
do $$ begin
  if to_regclass('auth.sessions') is not null then
    execute 'drop trigger if exists audit_app_change on auth.sessions';
    execute 'create trigger audit_app_change after insert or delete on auth.sessions
      for each row execute function public.audit_app_change()';
  end if;
end $$;

-- Browser records are explicitly untrusted. No arbitrary JSON payload, user ID,
-- timestamp or admin flag is accepted. A bounded batch prevents oversized writes.
create or replace function public.record_client_activity(p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare e jsonb; v_actor uuid := auth.uid();
begin
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception 'Invalid activity batch.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 17));
  if (select count(*) from public.activity_events where actor_id = v_actor and source = 'client'
      and created_at > now() - interval '1 minute') + jsonb_array_length(p_events) > 600 then
    raise exception 'Activity rate limit reached.';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if e->>'action' is null or e->>'action' not in
      ('navigation', 'click', 'change', 'submit', 'focus', 'hidden', 'visible', 'online', 'offline', 'api.success', 'api.error', 'api.start') then
      raise exception 'Invalid activity action.';
    end if;
    if coalesce(e->>'area', '') !~ '^[A-Za-z0-9_./:-]{0,100}$'
      or coalesce(e->>'control', '') !~ '^[A-Za-z0-9_./:-]{0,100}$' then
      raise exception 'Invalid activity context.';
    end if;
    insert into public.activity_events(actor_id, actor_is_admin, source, action, details)
    values (v_actor, public.is_app_admin(), 'client', e->>'action',
      jsonb_build_object('area', coalesce(e->>'area', ''), 'control', coalesce(e->>'control', '')));
  end loop;
end;
$$;

create or replace function public.admin_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_app_admin();
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'new_users_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'admins', (select count(*) from public.app_admins),
    'premium_users', (select count(distinct user_id) from public.subscriptions s
      where upper(status) = 'ACTIVE' and public.notification_subscription_plan(to_jsonb(s)) <> 'FREE'),
    'posts', (select count(*) from public.itineraries),
    'upcoming_posts', (select count(*) from public.itineraries where end_date >= current_date),
    'new_posts_30d', (select count(*) from public.itineraries where created_at >= now() - interval '30 days'),
    'requests', (select count(*) from public.requests),
    'pending_requests', (select count(*) from public.requests where status = 'PENDING'),
    'accepted_requests', (select count(*) from public.requests where status = 'ACCEPTED'),
    'conversations', (select count(*) from public.chat_threads),
    'messages', (select count(*) from public.chat_messages),
    'notifications', (select count(*) from public.notifications),
    'unread_notifications', (select count(*) from public.notifications where not is_read),
    'completed_demo_checkouts', (select count(*) from public.subscription_checkouts where provider = 'mock' and status = 'COMPLETED'),
    'active_users_7d', (select count(distinct actor_id) from public.activity_events where created_at >= now() - interval '7 days'),
    'events_24h', (select count(*) from public.activity_events where created_at >= now() - interval '24 hours'),
    'client_errors_24h', (select count(*) from public.activity_events where source = 'client' and action = 'api.error' and created_at >= now() - interval '24 hours')
  ) into result;
  insert into public.activity_events(actor_id, actor_is_admin, source, action)
    values(auth.uid(), true, 'admin', 'admin.overview');
  return result;
end;
$$;

create or replace function public.admin_list(
  p_section text, p_search text default '', p_offset integer default 0,
  p_limit integer default 25, p_source text default '', p_actor uuid default null,
  p_from timestamptz default null, p_to timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; v_query text; v_filter text;
begin
  perform public.require_app_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
    or length(p_search) > 200 or p_source not in ('', 'database', 'admin', 'client') then
    raise exception 'Invalid list parameters.';
  end if;
  if p_section = 'users' then
    v_query := 'select u.id, u.email, p.display_name, u.created_at, u.last_sign_in_at,
      exists(select 1 from public.app_admins a where a.user_id = u.id) as is_admin,
      (select count(*) from public.itineraries i where i.owner_id = u.id) as posts,
      exists(select 1 from public.subscriptions s where s.user_id = u.id and upper(s.status) = ''ACTIVE''
        and public.notification_subscription_plan(to_jsonb(s)) <> ''FREE'') as is_premium
      from auth.users u left join public.profiles p on p.id = u.id';
    v_filter := 'where $1 = '''' or email ilike ''%'' || $1 || ''%'' or display_name ilike ''%'' || $1 || ''%'' or id::text = $1';
  elsif p_section = 'posts' then
    v_query := 'select i.id, i.owner_id, u.email as owner_email, i.origin_airport_code, i.destination_airport_code,
      i.start_date, i.end_date, i.created_at,
      (select count(*) from public.requests r where r.itinerary_id = i.id) as requests
      from public.itineraries i left join auth.users u on u.id = i.owner_id';
    v_filter := 'where $1 = '''' or origin_airport_code ilike ''%'' || $1 || ''%''
      or destination_airport_code ilike ''%'' || $1 || ''%'' or owner_email ilike ''%'' || $1 || ''%'' or id::text = $1';
  elsif p_section in ('activity', 'user-activity') then
    v_query := 'select e.id, e.created_at, e.actor_id, e.actor_is_admin, e.source, e.action, e.entity_type, e.entity_id,
      e.subject_user_id, e.details, au.email as actor_email, ap.display_name as actor_display_name,
      su.email as subject_email, sp.display_name as subject_display_name
      from public.activity_events e
      left join auth.users au on au.id = e.actor_id
      left join public.profiles ap on ap.id = e.actor_id
      left join auth.users su on su.id = e.subject_user_id
      left join public.profiles sp on sp.id = e.subject_user_id';
    if p_section = 'user-activity' then
      v_filter := 'where ($1 = '''' or action ilike ''%'' || $1 || ''%'' or entity_id = $1
        or actor_id::text = $1 or subject_user_id::text = $1
        or actor_email ilike ''%'' || $1 || ''%'' or actor_display_name ilike ''%'' || $1 || ''%''
        or subject_email ilike ''%'' || $1 || ''%'' or subject_display_name ilike ''%'' || $1 || ''%'')
        and ($4 = '''' or source = $4) and ($5 is null or actor_id = $5 or subject_user_id = $5)
        and ($6 is null or created_at >= $6) and ($7 is null or created_at < $7)';
    else
      v_filter := 'where ($1 = '''' or action ilike ''%'' || $1 || ''%'' or entity_id = $1)
      and ($4 = '''' or source = $4) and ($5 is null or actor_id = $5 or subject_user_id = $5)
      and ($6 is null or created_at >= $6) and ($7 is null or created_at < $7)';
    end if;
  else raise exception 'Invalid admin section.';
  end if;
  -- Only constant SQL fragments are interpolated. All caller values are bound.
  execute 'with filtered as (' || 'select * from (' || v_query || ') q ' || v_filter || '),
    page as (select * from filtered order by created_at desc, id desc limit $2 offset $3)
    select jsonb_build_object(''rows'', coalesce((select jsonb_agg(to_jsonb(page)) from page), ''[]''::jsonb),
      ''total'', (select count(*) from filtered))'
    into result using coalesce(p_search, ''), p_limit, p_offset, p_source, p_actor, p_from, p_to;
  insert into public.activity_events(actor_id, actor_is_admin, source, action, details)
    values(auth.uid(), true, 'admin', 'admin.list', jsonb_build_object('section', p_section));
  return result;
end;
$$;

-- Internal helper intentionally has no browser execution privilege.
create or replace function public.admin_remove_post_data(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chat_messages where thread_id in (select id from public.chat_threads where itinerary_id = p_id);
  delete from public.chat_threads where itinerary_id = p_id;
  delete from public.requests where itinerary_id = p_id;
  delete from public.notifications where itinerary_id = p_id;
  delete from public.itinerary_contact_details where itinerary_id = p_id;
  delete from public.itinerary_legs where itinerary_id = p_id;
  delete from public.itineraries where id = p_id;
end;
$$;

create or replace function public.admin_delete_post(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_app_admin();
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'A reason (3-500 characters) is required.'; end if;
  perform 1 from public.itineraries where id = p_id for update;
  if not found then raise exception 'Post not found. Refresh the list.'; end if;
  insert into public.activity_events(actor_id, actor_is_admin, source, action, entity_type, entity_id, details)
    values(auth.uid(), true, 'admin', 'admin.delete_post', 'itineraries', p_id::text, jsonb_build_object('reason', btrim(p_reason)));
  perform public.admin_remove_post_data(p_id);
end;
$$;

create or replace function public.admin_delete_user(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_post uuid; v_has_storage boolean;
begin
  perform public.require_app_admin();
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'A reason (3-500 characters) is required.'; end if;
  -- This conflicts with the FK key-share lock taken when granting admin access.
  perform 1 from auth.users where id = p_id for update;
  if not found then raise exception 'Account not found. Refresh the list.'; end if;
  if p_id = auth.uid() or exists(select 1 from public.app_admins where user_id = p_id) then
    raise exception 'Admin accounts cannot be deleted. Revoke the role in SQL first.' using errcode = '42501';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists(select 1 from storage.objects o where to_jsonb(o)->>''owner_id'' = $1 or to_jsonb(o)->>''owner'' = $1)'
      into v_has_storage using p_id::text;
    if v_has_storage then raise exception 'Account owns Storage files. Remove or transfer them in Supabase Storage before deleting the account.'; end if;
  end if;
  insert into public.activity_events(actor_id, actor_is_admin, source, action, entity_type, entity_id, subject_user_id, details)
    values(auth.uid(), true, 'admin', 'admin.delete_user', 'users', p_id::text, p_id, jsonb_build_object('reason', btrim(p_reason)));
  for v_post in select id from public.itineraries where owner_id = p_id for update loop
    perform public.admin_remove_post_data(v_post);
  end loop;
  delete from public.chat_messages where sender_id = p_id or thread_id in
    (select id from public.chat_threads where owner_id = p_id or requester_id = p_id);
  delete from public.chat_threads where owner_id = p_id or requester_id = p_id;
  delete from public.requests where owner_id = p_id or requester_id = p_id;
  delete from public.itinerary_contact_details where owner_id = p_id;
  delete from public.notifications where user_id = p_id;
  delete from public.subscription_checkouts where user_id = p_id;
  delete from public.subscriptions where user_id = p_id;
  delete from public.profiles where id = p_id;
  -- Same transaction as app cleanup and audit. Unknown FK dependencies abort
  -- everything rather than leaving a partially deleted account.
  delete from auth.users where id = p_id;
end;
$$;

revoke all on function public.is_app_admin() from public, anon, authenticated;
revoke all on function public.require_app_admin() from public, anon, authenticated;
revoke all on function public.audit_app_change() from public, anon, authenticated;
revoke all on function public.record_client_activity(jsonb) from public, anon, authenticated;
revoke all on function public.admin_overview() from public, anon, authenticated;
revoke all on function public.admin_list(text, text, integer, integer, text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_remove_post_data(uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_post(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_delete_user(uuid, text) from public, anon, authenticated;
grant execute on function public.is_app_admin(), public.record_client_activity(jsonb), public.admin_overview(),
  public.admin_list(text, text, integer, integer, text, uuid, timestamptz, timestamptz),
  public.admin_delete_post(uuid, text), public.admin_delete_user(uuid, text) to authenticated;
commit;
