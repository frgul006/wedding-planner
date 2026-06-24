alter table public.weddings
add column food_and_drink_info text;

comment on column public.weddings.food_and_drink_info is
  'Guest-facing Wedding settings food and drink details shown on Brevkort invite details panel. Separate from RSVP dietary details.';
