# Wedding Planner

This context captures guest-facing wedding invitation language for the wedding planning app. Terms around **Invited Guest**, **Plus-one Guest**, **Scoped Invite access**, and **Message target** describe the accepted target model for the pending Guest remodel; legacy docs and code may still reflect the pre-remodel storage shape until that PRD is implemented.

## Language

**Wedding**:
The celebration being planned and administered in the app.
_Avoid_: event, app install

**Wedding name**:
The admin-maintained title of the **Wedding** used for the **Calendar action** event title and legacy display contexts.
_Avoid_: Public Wedding identity, partner-name display

**Guest**:
A person associated with the **Wedding** as either an **Invited Guest** or a **Plus-one Guest**.
_Avoid_: attendee, invitee

**Invited Guest**:
A **Guest** with full **Invite access** who owns an **RSVP** for themself and any **Plus-one Guest**.
_Avoid_: primary attendee, RSVP owner, invitee

**Plus-one Guest**:
A **Guest** tied to an **Invited Guest** through that Invited Guest's **RSVP**.
_Avoid_: embedded plus-one field, extra attendee, anonymous plus-one

**Invite**:
The private guest-facing invitation experience for a **Guest**.
_Avoid_: invitation page, public page

**Guest lifecycle mutation**:
An admin or RSVP write that changes whether a **Guest** is active or archived and applies any lifecycle-coupled **Invite access** changes atomically.
_Avoid_: ad hoc delete cascade, scattered guest cleanup

**Admin Guest roster**:
The admin-facing read view of active **Guest** records with their **Invite access** affordances and **RSVP** summary.
_Avoid_: raw guests table, invitee list

**Admin Guest mutation**:
The admin-facing write path for adding or editing active **Guest** identity, contact, +1 permission, SMS consent, and notes.
_Avoid_: ad hoc guest form parsing, raw guest update action

**Invite access**:
Whether a private **Invite** link currently grants a **Guest** access to their **Invite**.
_Avoid_: invite state, login session, public access

**Scoped Invite access**:
**Invite access** for a **Plus-one Guest** that shows non-RSVP **Invite** information and grants Wedding hub access.
_Avoid_: read-only login, partial invite, limited access

**Wedding hub access**:
Whether the shared Wedding hub can be used for guest actions such as photo upload, granted either by open anonymous uploads or by a valid Guest navigation session tied to an active, non-archived **Guest**.
_Avoid_: stale invite cookie permission, QR upload bypass

**Wedding hub photo upload**:
A Wedding hub action that signs direct photo upload intents, verifies uploaded photo objects, attributes them through **Wedding hub access**, and applies the **Wedding settings** photo review policy before photos appear to Guests.
_Avoid_: raw storage upload, public bucket write, QR photo post

**RSVP**:
An **Invited Guest**'s answer to whether they and any **Plus-one Guest** will attend the **Wedding**, captured inside their **Invite**.
_Avoid_: generic response, attendance record

**Message target**:
An active, non-archived **Guest** eligible to receive a Wedding SMS because they have a compact E.164 phone number, SMS consent is granted, and SMS opt-out is absent.
_Avoid_: SMS recipient, contact, raw phone row

**Invite SMS**:
A Wedding SMS sent to an **Invited Guest** who is a **Message target** for the purpose of delivering that Guest's individual **Invite** link.
_Avoid_: invite blast, invitation text, bulk invite link message

**Invite SMS template**:
The **Wedding settings** text pattern used to render each **Invite SMS** with that **Invited Guest**'s first name and individual **Invite** link.
_Avoid_: hardcoded invite text, one-off SMS body, message copy

**Invite RSVP navigation**:
The URL and panel-navigation contract that returns an **Invited Guest** to the **Invite** RSVP confirmation after saving an **RSVP**.
_Avoid_: redirect hack, query flag, client action workaround

**Calendar action**:
A guest-facing action for saving the **Wedding** time and place in a personal calendar.
_Avoid_: calendar invite, calendar RSVP, appointment

**Wedding settings**:
The admin-maintained **Wedding** details that become guest-facing **Invite** and Wedding hub information.
_Avoid_: event details, app config, settings form

**Public Wedding identity**:
The guest-facing partner names and couple mark derived from explicit **Wedding settings** partner fields, reused by the **Invite**, invalid-Invite contact, and Wedding hub.
_Avoid_: parsed wedding name, legacy title initials, inferred couple names

**Wedding start time**:
The intended local Stockholm date and clock time when the wedding celebration begins.
_Avoid_: UTC time, server time, browser-local time

**Wedding end time**:
The intended local Stockholm date and clock time when the wedding celebration ends.
_Avoid_: inferred duration, same-day closing time, browser-local time

**Time Plan**:
The ordered schedule entries for the **Wedding**, each with a local clock time and guest-facing label.
_Avoid_: timeline, itinerary, label-only schedule notes, `time_plan` strings

**Bröllopsfest**:
The Swedish guest-facing name for the wedding celebration/party.
_Avoid_: Efterfest

## Relationships

- A **Wedding** has exactly one set of **Wedding settings**.
- **Wedding settings** include one **Public Wedding identity** derived from explicit partner-name fields.
- **Wedding settings** include exactly one **Wedding start time**.
- **Wedding settings** may include one **Wedding end time** later than **Wedding start time**.
- **Wedding settings** include zero or more **Time Plan** entries.
- **Wedding settings** include one **Invite SMS template**.
- An **Invite** shows the **Public Wedding identity**, **Wedding start time**, and **Time Plan** to a **Guest**.
- A **Calendar action** title uses **Wedding name**.
- A **Calendar action** requires **Wedding start time** and **Wedding end time**, and includes **Wedding settings** place details when configured.
- A **Calendar action** is available to an **Invited Guest** after a submitted yes/maybe **RSVP** and to any **Plus-one Guest** with **Scoped Invite access**.
- A **Calendar action** respects current **Invite access**; revoked or regenerated **Invite** links stop working.
- An **Invited Guest** may have zero or one **Plus-one Guest**.
- A **Plus-one Guest** is tied to exactly one **Invited Guest**.
- The **Admin Guest roster** shows both **Invited Guest** and **Plus-one Guest**, labels which kind each **Guest** is, and shows the tied **Invited Guest** for each **Plus-one Guest**.
- An **Admin Guest mutation** adds or edits active **Invited Guest** records; RSVP-managed **Plus-one Guest** identity and contact fields stay read-only to admins.
- A **Plus-one Guest** created from RSVP plus-one details remains RSVP-managed: admin can view, archive, and manage **Scoped Invite access**, while identity and contact fields sync from the tied **Invited Guest**'s **RSVP**.
- A **Guest lifecycle mutation** archives a **Guest** and any tied RSVP-managed **Plus-one Guest** records in one atomic write path.
- **Invite access** is checked before showing Guest-specific **Invite** details.
- **Invite access** scope is a property of an Invite token: full scope grants an **Invited Guest** RSVP-capable access, while scoped tokens grant **Scoped Invite access** to a **Plus-one Guest**.
- Archived **Guest** records and revoked Invite tokens deny **Invite access** regardless of scope.
- Archived **Guest** records also stop Guest-cookie-based **Wedding hub access** when anonymous uploads are disabled.
- **Wedding hub access** controls whether a **Wedding hub photo upload** can be signed or finalized.
- A **Wedding hub photo upload** can be anonymous or attributed to the active, non-archived **Guest** behind **Wedding hub access**.
- The **Wedding settings** photo review policy determines whether a verified **Wedding hub photo upload** appears to Guests immediately or waits for admin review.
- A **Guest lifecycle mutation** revokes active scoped Invite tokens for archived **Plus-one Guest** records.
- **Invite access**, **Invite SMS** sent activity, opened-Invite activity, and **RSVP** status are distinct.
- **Scoped Invite access** lets a **Plus-one Guest** view non-RSVP **Invite** details and access the Wedding hub, but not submit an **RSVP**.
- **Wedding hub access** for guest-only uploads requires a valid Guest navigation session whose **Guest** is still active and non-archived.
- An **Invite** lets an **Invited Guest** submit or update an **RSVP**.
- An **RSVP** can name one **Plus-one Guest** when the **Invited Guest** has +1 permission.
- A **Plus-one Guest** inherits the tied **Invited Guest**'s **RSVP** status for Message target audiences.
- A **Message target** is an active, non-archived **Guest** with valid phone, SMS consent, and no SMS opt-out timestamp, not a raw phone number.
- An **Invite SMS template** must render the **Invited Guest**'s first name and individual **Invite** link.
- An **Invite SMS** goes only to an **Invited Guest** who is a **Message target** and carries that Guest's individual **Invite** link.
- Sending an **Invite SMS** replaces any previous full **Invite access** link for that **Invited Guest** with the link in that SMS.
- Bulk **Invite SMS** sends skip **Invited Guest** records that already have an **Invite SMS** accepted for sending, opened their **Invite**, or submitted an **RSVP**, unless an admin explicitly resends.
- An admin may explicitly send or resend an **Invite SMS** to one eligible **Invited Guest** regardless of **RSVP** status.
- Failed **Invite SMS** attempts do not count as previously sent.
- A failed **Invite SMS** attempt may leave its generated **Invite** link active; a later retry replaces it.
- **Invite RSVP navigation** brings an **Invited Guest** back to the **Invite** RSVP confirmation after a successful save.

## Example dialogue

> **Dev:** "If an admin enters 16:30 for the **Wedding start time**, should guests ever see 18:30 because production runs in UTC?"
> **Domain expert:** "No — the **Wedding start time** is the Stockholm wall-clock time guests should plan around. It belongs in **Wedding settings** with the guest-facing **Time Plan**."
>
> **Dev:** "Should a plus-one submit their own **RSVP**?"
> **Domain expert:** "No — the **Invited Guest** owns the **RSVP**. The **Plus-one Guest** can use **Scoped Invite access** to read the **Invite** and reach the Wedding hub."

## Flagged ambiguities

- "starting time" could mean server/browser timezone behavior — resolved: **Wedding start time** means Stockholm wall-clock time.
- "end time" could mean inferred duration, same-day clock time, or explicit closing date/time — resolved: **Wedding end time** means optional explicit Stockholm date and clock time later than **Wedding start time**.
- "event details" could mean admin form fields, guest-facing copy, or deployment config — resolved: use **Wedding settings** for Wedding-specific editable details.
- "timeline", "itinerary", and `time_plan` strings all describe schedule entries — resolved: use **Time Plan** for the domain concept and keep storage/UI formats as implementation details.
- Label-only schedule notes look like **Time Plan** entries but lack a clock time — resolved: **Time Plan** entries require a local clock time.
- "Add to calendar" means **Calendar action**; "calendar invite" is avoided because **Invite** already means the private guest-facing invitation experience.
- **Calendar action** title intentionally uses **Wedding name** rather than **Public Wedding identity**; **Public Wedding identity** remains the normal guest-facing Invite/Wedding hub identity.
- "after RSVP" for **Calendar action** applies to **Invited Guest** access; **Scoped Invite access** **Plus-one Guest** may use **Calendar action** without owning an **RSVP**.
- "Invite state" could mean token validity, Invite SMS sent activity, opened/RSVP status, or panel UI state — resolved: use **Invite access** for valid/invalid link checks, and keep sent/opened/RSVP activity separate.
- `invite_status` mixed opened-Invite activity with **RSVP** status — resolved: model opened-Invite activity separately from a dedicated **RSVP** status for **Invited Guest**.
- "Guest" previously meant only the person who owns an **RSVP** — resolved: use **Invited Guest** for the RSVP owner and **Plus-one Guest** for the tied guest.
- **Invite access** does not always imply RSVP permission — resolved: **Scoped Invite access** grants non-RSVP Invite details and Wedding hub access to a **Plus-one Guest**.
- "recipient" can mean a phone number, delivery row, or person — resolved: use **Message target** for a **Guest** eligible to receive Wedding SMS.
- "send invites to everyone" could mean regenerating links for every eligible Guest on every send — resolved: bulk **Invite SMS** sends target eligible **Invited Guest** records without a prior sent **Invite SMS**, opened **Invite**, or submitted **RSVP** unless an admin explicitly resends.
- "unsent" could mean no active Invite link or no prior Invite SMS — resolved: it means no prior sent **Invite SMS**; active admin-generated links do not make an **Invited Guest** sent, but opened **Invite** or submitted **RSVP** still skips bulk sends.
- "received an Invite SMS" could mean attempted, accepted for sending, carrier-delivered, opened, or read — resolved: accepted for sending counts as sent; failed attempts do not.
- Plural **Invite SMS** copy could imply one **Guest** row represents a couple or household — resolved: **Guest** remains one person; plural copy is tone, not the data model.
- Older data-model text says every **Guest** owns an RSVP response — resolved target model: only **Invited Guest** owns **RSVP**; **Plus-one Guest** inherits RSVP status through the tied **Invited Guest**.
- `rsvp_status=submitted#osa` is an implementation detail of **Invite RSVP navigation**, not a durable **RSVP** status.
