alter table public.weddings
add column wedding_end_date timestamptz;

alter table public.weddings
add constraint weddings_end_after_start_check check (
  wedding_end_date is null
  or wedding_date is null
  or wedding_end_date > wedding_date
);

comment on column public.weddings.wedding_end_date is
  'Optional Wedding end time used only for guest calendar downloads.';
