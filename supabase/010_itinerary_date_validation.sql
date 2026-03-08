-- Enforce non-past itinerary dates and valid start/end ordering.

create or replace function public.validate_itinerary_dates()
returns trigger
language plpgsql
as $$
begin
  if new.start_date < current_date then
    raise exception 'start_date cannot be in the past';
  end if;

  if new.end_date < current_date then
    raise exception 'end_date cannot be in the past';
  end if;

  if new.end_date < new.start_date then
    raise exception 'end_date must be on or after start_date';
  end if;

  return new;
end;
$$;

drop trigger if exists itineraries_validate_dates on public.itineraries;
create trigger itineraries_validate_dates
before insert or update on public.itineraries
for each row execute function public.validate_itinerary_dates();
