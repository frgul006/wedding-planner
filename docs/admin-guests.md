# Admin guest management

Admin guest management is implemented at `/admin/guests`. The **Admin Guest roster** read model lives in `lib/admin-guest-roster.ts`; the page is the rendering Adapter. The **Admin Guest mutation** add/edit and Invite-link orchestration lives in `lib/admin-guest-mutation.ts`; server actions are thin revalidation, redirect, or action-state Adapters. The **Guest lifecycle mutation** archive path lives in `lib/guest-lifecycle.ts` and the `public.archive_guest_lifecycle` RPC, with admin status mapping behind the Admin Guest mutation Interface.

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

## Roster workflow, exports and catering

- Compact responsive rows combine identity/OSA, contact details, consent and actions. Expand **Detaljer** for a full-width, editable private note; RSVP-managed +1 identity/contact fields remain read-only, but their notes are editable.
- Combine text search, guest type, RSVP/invite status and **Mat och allergier** filters. **Matpreferens eller allergi** matches either field; separate food-only/allergy-only and missing-details filters are available. Search includes email, private notes, dietary text and the tied guest name.
- `Ej öppnad · ej svarat` and `Öppnad · ej svarat` both require an unanswered RSVP. URL search/status filters use the same predicate as the editor, and clearing them restores the entire roster.
- The roster and related queries are paginated internally; neither the UI nor exports silently truncate at 500/1000 rows.
- Drafts stay above saved rows. Adding a draft clears filters so it is immediately visible. Bulk controls appear only after selecting guests and show hidden selections. Unsaved edits block bulk actions and link regeneration.
- The row OSA selector supports Ja, Nej and Kanske. Changes save with the other edits in one atomic, version-checked transaction. Admin updates keep `guests.rsvp_status` and `rsvp_responses.attendance` consistent and propagate to active RSVP-managed +1 Guests. A +1 shares the invited guest's response: change OSA on that invited guest, not independently on the +1. Dietary fields, companion membership and invite-open activity are preserved. Admin updates clear token attribution; later guest submissions can replace the response again. Existing responses cannot be reset to unanswered here.
- Apply migration `20260905150000_admin_guest_roster_improvements.sql` before deploying this UI. It updates `save_admin_guest_roster_session`; active-admin wedding authorization and all-or-nothing version checks remain enforced in the database. It does not backfill or erase guest data.

### Raw guest exports

`/admin/guests/export?format=csv` and `?format=json` download **all saved active guests**, regardless of current UI filters. Unsaved edits and archived guests are excluded. Both formats require the current wedding's active admin session and return `private, no-store` responses.

JSON includes raw allowlisted guest fields and each guest's own RSVP row (`rsvp`, null if absent). A +1 refers to its parent via `invited_guest_id`; its dietary fields live in that parent's RSVP. CSV flattens those fields with `rsvp_` prefixes and adds per-person `effective_food_preference`/`effective_allergy_notes`. No token hashes, private invite links, session credentials or auth records are exported.

CSV uses UTF-8 BOM, quoted RFC 4180 fields and spreadsheet-formula neutralization (including phone numbers beginning with `+`). Use JSON for lossless raw values and nulls. **Raw exports contain contacts and private notes: do not send these to catering.**

### Catering handoff

`/admin/guests/catering` shows saved **yes** attendees only, including +1 people exactly once, grouped food preferences/allergy notes and a named person list. Download a shareable text summary or CSV person list. Both exclude contacts and private admin notes.

Historical named +1 responses without guest rows are included once and flagged for confirmation. Archived companions are not resurrected from old RSVP details; mismatches are flagged instead. Unknown/missing dietary data is labelled `Ej angivet`, never assumed allergy-free. Only whitespace around text and case are normalized for grouping; free text is not split or medically interpreted. One person can appear in both dietary summaries, so group totals are not additive. Review warnings with the caterer before ordering.

## Local validation

After creating a local Supabase Auth user and matching `admin_profiles` row, visit:

```txt
http://localhost:3000/admin/guests
```
