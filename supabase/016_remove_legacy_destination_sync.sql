-- Repair databases where migration 015 already removed destination while the
-- original schema's synchronization trigger remained installed.
begin;

drop trigger if exists trg_sync_itineraries_destination_columns on public.itineraries;
drop function if exists public.sync_itineraries_destination_columns();

-- No CASCADE: unrelated dependencies must not be removed. Date validation and
-- the remaining airport columns are intentionally unchanged.
commit;
