insert into public.weddings (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Our Wedding')
on conflict (id) do nothing;
