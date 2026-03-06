-- Allow re-request after CANCELLED/REJECTED while preventing active duplicates per request type.

alter table public.requests
  drop constraint if exists requests_unique_pair;

drop index if exists public.requests_unique_pair;
drop index if exists public.requests_active_unique_idx;

create unique index requests_active_unique_idx
  on public.requests (itinerary_id, requester_id, owner_id, request_type)
  where status in ('PENDING', 'ACCEPTED');
