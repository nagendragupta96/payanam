-- Add CONTACT_DETAILS request type and restrict contact visibility to accepted CONTACT_DETAILS requests.

alter table public.requests
  drop constraint if exists requests_request_type_check;

alter table public.requests
  add constraint requests_request_type_check
  check (request_type is null or request_type in ('COMPANION', 'ASSISTANCE', 'CONTACT_DETAILS'));

drop policy if exists icd_requester_select_when_accepted on public.itinerary_contact_details;

create policy icd_requester_select_when_accepted_contact_details
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
      and r.request_type = 'CONTACT_DETAILS'
      and r.status = 'ACCEPTED'
  )
);
