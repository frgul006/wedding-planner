insert into public.weddings (
  id,
  name,
  partner_one_name,
  partner_two_name,
  venue_area,
  time_plan,
  dress_code,
  child_policy,
  gift_info,
  invite_support_email,
  invite_sms_template
)
values (
  '00000000-0000-0000-0000-000000000001',
  'Our Wedding',
  'Fredrik',
  'Matilda',
  'Johanneshov',
  '[{"time":"16:30","label":"Välkomstdrinkar"},{"time":"18:30","label":"Middag"}]'::jsonb,
  'Festlig sommarformal',
  'Vi älskar era barn, men firar vuxet den här kvällen.',
  'Din närvaro är den bästa presenten.',
  'osa@example.com',
  'Hej {{first_name}}! Välkomna att fira vår dag tillsammans med oss. Här är er personliga inbjudan där ni kan OSA: {{invite_link}} / Fredrik & Matilda'
)
on conflict (id) do update set
  partner_one_name = excluded.partner_one_name,
  partner_two_name = excluded.partner_two_name,
  venue_area = excluded.venue_area,
  time_plan = excluded.time_plan,
  dress_code = excluded.dress_code,
  child_policy = excluded.child_policy,
  gift_info = excluded.gift_info,
  invite_support_email = excluded.invite_support_email,
  invite_sms_template = excluded.invite_sms_template;
