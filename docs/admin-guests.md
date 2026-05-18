# Admin guest management

Admin guest management is implemented at `/admin/guests`. The **Admin Guest roster** read model lives in `lib/admin-guest-roster.ts`; the page is the rendering Adapter. The **Guest lifecycle mutation** archive path lives in `lib/guest-lifecycle.ts` and the `public.archive_guest_lifecycle` RPC.

## Access

The page requires:

- a valid Supabase Auth session
- an active `admin_profiles` row for the signed-in user

Server actions verify the active admin profile before creating, updating, or archiving guests.

## Data model

Guests are stored in `public.guests` with RLS enabled.

Important fields:

- `wedding_id` scopes each guest to a wedding
- `full_name` is required
- `email` or `phone` is required for Invited Guests; RSVP-managed Plus-one Guests can be name-only
- `guest_kind` is `invited` or `plus_one`; current roster Guests default to Invited Guests
- `invited_guest_id` ties each Plus-one Guest to the Invited Guest whose RSVP manages them
- `rsvp_managed` marks Plus-one Guest identity/contact fields that come from RSVP sync
- `invite_status` stores opened-Invite activity (`not replied` or `opened`)
- `rsvp_status` stores the dedicated RSVP status (`not replied`, `rsvp yes`, `rsvp no`, `rsvp maybe`)
- `plus_one_allowed` defaults to `false` and controls whether the Brevkort OSA UI offers a +1 to Invited Guests
- `deleted_at` implements soft delete/archive behavior

Normal admin lists only show guests where `deleted_at is null`.

## Features

- Add guest
- Edit name, email, phone, +1 permission, SMS update consent, and notes inline
- Search by partial name or phone
- Filter by current Guest status, including opened-Invite activity and RSVP status
- Sort by name, status, or newest
- Show current Invite opened status and dedicated RSVP status
- Show Invited Guest and Plus-one Guest labels
- Show the tied Invited Guest for each Plus-one Guest
- Mark RSVP-managed Plus-one Guest identity/contact fields as RSVP-managed/read-only
- Show current RSVP details when submitted, including extra guest count, food preference, allergy/special notes, and latest submission time; Plus-one Guest rows show their tied Invited Guest RSVP's plus-one details
- Store named +1 RSVP details for the Brevkort OSA flow when allowed by the guest's +1 permission
- Sync future RSVP +1 details into one tied RSVP-managed Plus-one Guest; removing +1 details archives that Guest and revokes active scoped tokens
- Reflect phone numbers updated by token-backed RSVP submissions in the editable Phone column
- Delete with browser confirmation; archive uses one **Guest lifecycle mutation** RPC that sets `deleted_at` instead of hard-deleting
- Archiving an Invited Guest also archives tied RSVP-managed Plus-one Guests and revokes active scoped tokens for archived Guests atomically
- Generate or regenerate full private invite links for Invited Guests and scoped private invite links for Plus-one Guests; raw links are shown only immediately after generation

## Brevkort +1 flow

The data model, admin +1 permission controls, and public Brevkort OSA named +1 UI are in place. Admins control whether each Invited Guest sees the +1 option; guest-facing submissions store named +1 details when selected and clear them when the guest switches back to `Nej, bara jag`.

Future RSVP submissions with +1 details create or update one active RSVP-managed Plus-one Guest tied to the submitting Invited Guest. Name-only Plus-one Guests can exist without becoming Message targets because SMS targeting still requires a valid phone and SMS consent. Admins can generate scoped Invite links for active Plus-one Guests so they can view non-RSVP Invite details and receive Wedding hub access. Removing +1 details archives the tied Plus-one Guest and revokes active scoped Invite tokens. Existing historical RSVP +1 rows are not backfilled automatically.

## Local validation

After creating a local Supabase Auth user and matching `admin_profiles` row, visit:

```txt
http://localhost:3000/admin/guests
```
