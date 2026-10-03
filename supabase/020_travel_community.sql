-- Apply after 019. No Realtime publication or additional auth client is needed.
begin;

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  category text not null check (category in ('Airport Update','Trip Experience','Travel Question','Travel Tip','Delay / Disruption','Layover','Immigration / Security','Baggage','Transportation','Companion / Assistance','Other')),
  title text not null check (length(btrim(title)) between 1 and 160),
  content text not null check (length(btrim(content)) between 1 and 10000),
  airport_code text check (airport_code ~ '^[A-Z]{3,4}$'),
  origin_airport text check (origin_airport ~ '^[A-Z]{3,4}$'),
  destination_airport text check (destination_airport ~ '^[A-Z]{3,4}$'),
  flight_number text check (length(flight_number) between 1 and 20),
  travel_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.community_comments(id) on delete set null,
  content text not null check (length(btrim(content)) between 1 and 3000),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_comment_id is distinct from id)
);
create table if not exists public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('like','support','thanks','helpful')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id) = 1)
);
create unique index if not exists community_reactions_post_unique on public.community_reactions(user_id, post_id) where post_id is not null;
create unique index if not exists community_reactions_comment_unique on public.community_reactions(user_id, comment_id) where comment_id is not null;
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reason text not null check (reason in ('Spam','Harassment','False / Misleading Information','Inappropriate Content','Privacy / Personal Information','Other')),
  details text not null default '' check (length(details) <= 2000),
  status text not null default 'OPEN' check (status in ('OPEN','REVIEWED','DISMISSED')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id) = 1)
);
create unique index if not exists community_reports_post_unique on public.community_reports(reporter_user_id, post_id) where post_id is not null;
create unique index if not exists community_reports_comment_unique on public.community_reports(reporter_user_id, comment_id) where comment_id is not null;
create index if not exists community_posts_created_idx on public.community_posts(created_at desc, id desc);
create index if not exists community_posts_user_idx on public.community_posts(user_id, created_at desc);
create index if not exists community_posts_airport_idx on public.community_posts(airport_code, created_at desc);
create index if not exists community_posts_category_idx on public.community_posts(category, created_at desc);
create index if not exists community_posts_origin_idx on public.community_posts(origin_airport, created_at desc);
create index if not exists community_posts_destination_idx on public.community_posts(destination_airport, created_at desc);
create index if not exists community_posts_date_idx on public.community_posts(travel_date);
create index if not exists community_comments_post_idx on public.community_comments(post_id, created_at, id);
create index if not exists community_comments_parent_idx on public.community_comments(parent_comment_id, created_at, id);
create index if not exists community_comments_user_idx on public.community_comments(user_id);
create index if not exists community_reactions_post_idx on public.community_reactions(post_id);
create index if not exists community_reactions_comment_idx on public.community_reactions(comment_id);
create index if not exists community_reports_status_idx on public.community_reports(status, created_at);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_reports enable row level security;
revoke all on public.community_posts, public.community_comments, public.community_reactions, public.community_reports from public, anon, authenticated;
grant select, delete on public.community_posts, public.community_comments, public.community_reactions to authenticated;
grant insert(user_id,category,title,content,airport_code,origin_airport,destination_airport,flight_number,travel_date),
  update(category,title,content,airport_code,origin_airport,destination_airport,flight_number,travel_date) on public.community_posts to authenticated;
grant insert(user_id,post_id,parent_comment_id,content), update(content,is_deleted) on public.community_comments to authenticated;
grant insert(user_id,post_id,comment_id,reaction_type), update(reaction_type) on public.community_reactions to authenticated;
grant select, insert(reporter_user_id,post_id,comment_id,reason,details), update(status) on public.community_reports to authenticated;

do $$ declare t text; begin
  foreach t in array array['community_posts','community_comments','community_reactions'] loop
    execute format('drop policy if exists community_read on public.%I', t);
    execute format('create policy community_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists community_insert on public.%I', t);
    execute format('create policy community_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('drop policy if exists community_update on public.%I', t);
    execute format('create policy community_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists community_delete on public.%I', t);
    execute format('create policy community_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;
drop policy if exists community_report_insert on public.community_reports;
create policy community_report_insert on public.community_reports for insert to authenticated with check (reporter_user_id = auth.uid() and status = 'OPEN');
drop policy if exists community_report_read on public.community_reports;
create policy community_report_read on public.community_reports for select to authenticated using (reporter_user_id = auth.uid() or public.is_app_admin());
drop policy if exists community_report_moderate on public.community_reports;
create policy community_report_moderate on public.community_reports for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

create or replace function public.community_validate_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent public.community_comments;
begin
  if new.parent_comment_id is not null then
    -- Locking with the caller's UPDATE RLS would hide other authors' comments.
    -- This trigger can only validate; normal writes still pass the table RLS.
    select * into parent from public.community_comments where id = new.parent_comment_id for key share;
    if not found or parent.post_id <> new.post_id or parent.parent_comment_id is not null then
      raise exception 'Replies must belong to a top-level comment on the same post.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.is_deleted and (not new.is_deleted or new.content <> old.content) then raise exception 'Deleted comments cannot be edited.'; end if;
    new.updated_at := now();
  end if;
  if new.is_deleted then new.content := '[Comment deleted]'; end if;
  return new;
end $$;
drop trigger if exists community_comment_validate on public.community_comments;
create trigger community_comment_validate before insert or update on public.community_comments for each row execute function public.community_validate_comment();
create or replace function public.community_post_updated()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists community_post_updated on public.community_posts;
create trigger community_post_updated before update on public.community_posts for each row execute function public.community_post_updated();

-- Read projections join only public profile fields. Report details and private
-- Payanam tables are never joined. Every callable definer checks authentication.
create or replace function public.community_feed(
  p_search text default '', p_airport text default '', p_category text default '',
  p_origin text default '', p_destination text default '', p_date date default null,
  p_sort text default 'latest', p_mine boolean default false, p_offset integer default 0,
  p_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 or length(p_search) > 200
    or p_sort is null or p_sort not in ('latest','discussed') then raise exception 'Invalid feed filters.'; end if;
  with filtered as (
    select p.*, (select count(*) from public.community_comments c where c.post_id = p.id and not c.is_deleted) as comment_count
    from public.community_posts p
    where (p_id is null or p.id = p_id) and (not p_mine or p.user_id = auth.uid())
      and (p_airport = '' or p.airport_code = upper(p_airport)) and (p_category = '' or p.category = p_category)
      and (p_origin = '' or p.origin_airport = upper(p_origin)) and (p_destination = '' or p.destination_airport = upper(p_destination))
      and (p_date is null or p.travel_date = p_date)
      and (p_search = '' or position(lower(p_search) in lower(concat_ws(' ',p.title,p.content,p.airport_code,p.origin_airport,p.destination_airport,p.flight_number))) > 0)
  ), page as (
    select * from filtered order by case when p_sort = 'discussed' then comment_count end desc, created_at desc, id desc limit 21 offset p_offset
  ), enriched as (
    select p.*, coalesce(nullif(pr.display_name,''),'Traveler') as display_name, pr.avatar_url,
      coalesce((select jsonb_object_agg(reaction_type, n) from (select reaction_type,count(*) n from public.community_reactions r where r.post_id=p.id group by reaction_type) counts),'{}') as reactions,
      (select reaction_type from public.community_reactions r where r.post_id=p.id and r.user_id=auth.uid()) as my_reaction
    from page p left join public.profiles pr on pr.id=p.user_id
    order by case when p_sort = 'discussed' then p.comment_count end desc, p.created_at desc, p.id desc limit 20
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(e)) from enriched e),'[]'), 'has_more',(select count(*)>20 from page)) into result;
  return result;
end $$;

create or replace function public.community_comment_page(p_post uuid, p_parent uuid default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Invalid comment page.'; end if;
  with page as (
    select c.* from public.community_comments c where c.post_id=p_post and c.parent_comment_id is not distinct from p_parent
    order by c.created_at desc,c.id desc limit 21 offset p_offset
  ), enriched as (
    select c.*, coalesce(nullif(p.display_name,''),'Traveler') display_name, p.avatar_url,
      (select count(*) from public.community_comments r where r.parent_comment_id=c.id) reply_count,
      coalesce((select jsonb_object_agg(reaction_type,n) from (select reaction_type,count(*) n from public.community_reactions r where r.comment_id=c.id group by reaction_type) counts),'{}') reactions,
      (select reaction_type from public.community_reactions r where r.comment_id=c.id and r.user_id=auth.uid()) my_reaction
    from page c left join public.profiles p on p.id=c.user_id order by c.created_at desc,c.id desc limit 20
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(e)) from enriched e),'[]'), 'has_more',(select count(*)>20 from page)) into result;
  return result;
end $$;

create or replace function public.community_toggle_reaction(p_post uuid default null, p_comment uuid default null, p_type text default 'like')
returns void language plpgsql security invoker set search_path = '' as $$
declare existing public.community_reactions;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if num_nonnulls(p_post,p_comment) <> 1 or p_type is null or p_type not in ('like','support','thanks','helpful') then raise exception 'Invalid reaction.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || coalesce(p_post,p_comment)::text,20));
  select * into existing from public.community_reactions where user_id=auth.uid()
    and post_id is not distinct from p_post and comment_id is not distinct from p_comment;
  if found then
    if existing.reaction_type=p_type then delete from public.community_reactions where id=existing.id;
    else update public.community_reactions set reaction_type=p_type where id=existing.id; end if;
  else insert into public.community_reactions(post_id,comment_id,reaction_type) values(p_post,p_comment,p_type);
  end if;
end $$;

revoke all on function public.community_feed(text,text,text,text,text,date,text,boolean,integer,uuid),
  public.community_comment_page(uuid,uuid,integer), public.community_toggle_reaction(uuid,uuid,text),
  public.community_validate_comment(), public.community_post_updated() from public, anon, authenticated;
grant execute on function public.community_feed(text,text,text,text,text,date,text,boolean,integer,uuid),
  public.community_comment_page(uuid,uuid,integer), public.community_toggle_reaction(uuid,uuid,text) to authenticated;

-- Reuse existing privacy-safe audit collection; it records changed field names,
-- never community text, profile values or private report details.
do $$ declare t text; begin
  foreach t in array array['community_posts','community_comments','community_reactions','community_reports'] loop
    execute format('drop trigger if exists audit_app_change on public.%I',t);
    execute format('create trigger audit_app_change after insert or update or delete on public.%I for each row execute function public.audit_app_change()',t);
  end loop;
end $$;
commit;
