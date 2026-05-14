insert into public.weddings (
  id,
  name,
  venue_area,
  time_plan,
  dress_code,
  child_policy,
  gift_info,
  invite_support_email
)
values (
  '00000000-0000-0000-0000-000000000001',
  'Our Wedding',
  'Johanneshov',
  '[{"time":"16:30","label":"Välkomstdrinkar"},{"time":"18:30","label":"Middag"}]'::jsonb,
  'Festlig sommarformal',
  'Vi älskar era barn, men firar vuxet den här kvällen.',
  'Din närvaro är den bästa presenten.',
  'osa@example.com'
)
on conflict (id) do update set
  venue_area = excluded.venue_area,
  time_plan = excluded.time_plan,
  dress_code = excluded.dress_code,
  child_policy = excluded.child_policy,
  gift_info = excluded.gift_info,
  invite_support_email = excluded.invite_support_email;
