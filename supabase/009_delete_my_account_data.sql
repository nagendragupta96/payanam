-- Secure helper for deleting current user's app data before auth-user deletion.

create or replace function public.delete_my_account_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.chat_messages
  where sender_id = v_user_id
     or thread_id in (
       select id from public.chat_threads where owner_id = v_user_id or requester_id = v_user_id
     );

  delete from public.chat_threads
  where owner_id = v_user_id or requester_id = v_user_id;

  delete from public.requests
  where owner_id = v_user_id or requester_id = v_user_id;

  delete from public.itinerary_contact_details
  where owner_id = v_user_id
     or itinerary_id in (select id from public.itineraries where owner_id = v_user_id);

  delete from public.itinerary_legs
  where itinerary_id in (select id from public.itineraries where owner_id = v_user_id);

  delete from public.itineraries
  where owner_id = v_user_id;

  delete from public.subscriptions
  where user_id = v_user_id;

  delete from public.profiles
  where id = v_user_id;
end;
$$;

grant execute on function public.delete_my_account_data() to authenticated;
