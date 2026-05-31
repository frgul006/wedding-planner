alter table public.weddings
add column invite_sms_template text not null default 'Hej {{first_name}}! Välkomna att fira vår dag tillsammans med oss. Här är er personliga inbjudan där ni kan OSA: {{invite_link}} / Fredrik & Matilda';

alter table public.weddings
add constraint weddings_invite_sms_template_not_blank check (
  nullif(btrim(invite_sms_template), '') is not null
);

comment on column public.weddings.invite_sms_template is
'Saved Invite SMS template. Supports {{first_name}} and {{invite_link}} placeholders.';

alter table public.message_blasts
add column message_kind text not null default 'custom';

alter table public.message_blasts
add constraint message_blasts_message_kind_check check (
  message_kind in ('custom', 'invite_sms')
);

alter table public.message_deliveries
add column invite_token_id uuid references public.invite_tokens(id) on delete set null;

create index message_blasts_wedding_kind_idx
on public.message_blasts(wedding_id, message_kind, created_at desc);

create index message_deliveries_invite_token_idx
on public.message_deliveries(invite_token_id)
where invite_token_id is not null;
