# Use an all-or-nothing Admin Guest roster edit session

Status: accepted

The Guest roster will replace per-row save actions with one **Admin Guest roster edit session**: admins may add draft Invited Guests and edit admin-owned fields across many Guests, then commit those changes together or not at all. This avoids hidden row-specific save buttons, prevents partial roster commits, and matches the admin expectation that roster cleanup is one reviewed batch of work.

## Considered options

- Per-row saves: simpler implementation, but save buttons hide in horizontal overflow and make multi-Guest cleanup slow and easy to misread.
- Autosave cells: removes explicit save friction, but makes validation, review, and accidental edits harder to reason about.
- Partial batch save: saves valid rows and leaves failed rows dirty, but creates confusing half-committed roster state.

## Consequences

Roster field edits need a batch write path that validates all changed rows, rejects stale rows, and commits atomically. Side-effect actions such as Wedding SMS updates, Invite access regeneration, and Guest lifecycle archive actions stay separate selected-row actions; they do not run inside the roster edit session.
