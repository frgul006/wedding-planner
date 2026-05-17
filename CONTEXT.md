# Wedding Planner

This context captures guest-facing wedding invitation language for the wedding planning app.

## Language

**Wedding**:
The celebration being planned and administered in the app.
_Avoid_: event, app install

**Guest**:
A person invited to the **Wedding**.
_Avoid_: attendee, invitee

**Invite**:
The private guest-facing invitation experience for a **Guest**.
_Avoid_: invitation page, public page

**Invite access**:
Whether a private **Invite** link currently grants a **Guest** access to their **Invite**.
_Avoid_: invite state, login session, public access

**RSVP**:
A **Guest**'s answer to whether they will attend the **Wedding**, captured inside their **Invite**.
_Avoid_: generic response, attendance record

**Invite RSVP navigation**:
The URL and panel-navigation contract that returns a **Guest** to the **Invite** RSVP confirmation after saving an **RSVP**.
_Avoid_: redirect hack, query flag, client action workaround

**Wedding settings**:
The admin-maintained **Wedding** details that become guest-facing **Invite** and Wedding hub information.
_Avoid_: event details, app config, settings form

**Wedding start time**:
The intended local Stockholm date and clock time when the wedding celebration begins.
_Avoid_: UTC time, server time, browser-local time

**Time Plan**:
The ordered schedule entries for the **Wedding**, each with a local clock time and guest-facing label.
_Avoid_: timeline, itinerary, label-only schedule notes, `time_plan` strings

**Bröllopsfest**:
The Swedish guest-facing name for the wedding celebration/party.
_Avoid_: Efterfest

## Relationships

- A **Wedding** has exactly one set of **Wedding settings**.
- **Wedding settings** include exactly one **Wedding start time**.
- **Wedding settings** include zero or more **Time Plan** entries.
- An **Invite** shows the **Wedding start time** and **Time Plan** to a **Guest**.
- **Invite access** is checked before showing Guest-specific **Invite** details.
- An **Invite** lets a **Guest** submit or update an **RSVP**.
- **Invite RSVP navigation** brings a **Guest** back to the **Invite** RSVP confirmation after a successful save.

## Example dialogue

> **Dev:** "If an admin enters 16:30 for the **Wedding start time**, should guests ever see 18:30 because production runs in UTC?"
> **Domain expert:** "No — the **Wedding start time** is the Stockholm wall-clock time guests should plan around. It belongs in **Wedding settings** with the guest-facing **Time Plan**."

## Flagged ambiguities

- "starting time" could mean server/browser timezone behavior — resolved: **Wedding start time** means Stockholm wall-clock time.
- "event details" could mean admin form fields, guest-facing copy, or deployment config — resolved: use **Wedding settings** for Wedding-specific editable details.
- "timeline", "itinerary", and `time_plan` strings all describe schedule entries — resolved: use **Time Plan** for the domain concept and keep storage/UI formats as implementation details.
- Label-only schedule notes look like **Time Plan** entries but lack a clock time — resolved: **Time Plan** entries require a local clock time.
- "Invite state" could mean token validity, opened/RSVP status, or panel UI state — resolved: use **Invite access** for valid/invalid link checks.
- `rsvp_status=submitted#osa` is an implementation detail of **Invite RSVP navigation**, not a durable **RSVP** status.
