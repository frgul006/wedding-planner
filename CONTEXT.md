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

**Wedding start time**:
The intended local Stockholm date and clock time when the wedding celebration begins.
_Avoid_: UTC time, server time, browser-local time

**Bröllopsfest**:
The Swedish guest-facing name for the wedding celebration/party.
_Avoid_: Efterfest

## Relationships

- A **Wedding** has exactly one **Wedding start time**.
- An **Invite** shows the **Wedding start time** to a **Guest**.

## Example dialogue

> **Dev:** "If an admin enters 16:30 for the **Wedding start time**, should guests ever see 18:30 because production runs in UTC?"
> **Domain expert:** "No — the **Wedding start time** is the Stockholm wall-clock time guests should plan around."

## Flagged ambiguities

- "starting time" could mean server/browser timezone behavior — resolved: **Wedding start time** means Stockholm wall-clock time.
