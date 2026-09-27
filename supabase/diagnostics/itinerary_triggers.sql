-- Read-only inspection of the deployed trigger code; no account rows are read.
select
  t.tgname as trigger_name,
  t.tgrelid::regclass::text as table_name,
  pg_get_triggerdef(t.oid) as trigger_definition,
  pg_get_functiondef(t.tgfoid) as function_definition
from pg_trigger t
where t.tgrelid in (
  to_regclass('public.itineraries'),
  to_regclass('public.itinerary_legs')
)
and not t.tgisinternal
order by table_name, trigger_name;
