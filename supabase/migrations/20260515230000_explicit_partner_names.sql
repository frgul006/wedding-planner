alter table public.weddings
add column partner_one_name text,
add column partner_two_name text;

comment on column public.weddings.partner_one_name is
  'Explicit first partner display name for public Brevkort invite covers. Nullable so admins can intentionally show a safe placeholder.';
comment on column public.weddings.partner_two_name is
  'Explicit second partner display name for public Brevkort invite covers. Nullable so admins can intentionally show a safe placeholder.';
