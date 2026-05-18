import { expect, test } from "@playwright/test";

import {
  buildAdminGuestRosterRows,
  normalizeAdminGuestRosterFilters,
  type AdminGuestRosterGuestRow,
  type AdminGuestRosterRsvpResponseRow,
} from "../lib/admin-guest-roster";

function guestRow(overrides: Partial<AdminGuestRosterGuestRow> = {}): AdminGuestRosterGuestRow {
  return {
    created_at: "2026-05-18T08:00:00.000Z",
    email: "guest@example.com",
    full_name: "Test Guest",
    guest_kind: "invited",
    id: "guest-1",
    invite_status: "not replied",
    invited_guest_id: null,
    notes: null,
    phone: "+46700000001",
    plus_one_allowed: false,
    rsvp_managed: false,
    rsvp_status: "not replied",
    sms_opt_in: false,
    ...overrides,
  };
}

function rsvpResponseRow(
  overrides: Partial<AdminGuestRosterRsvpResponseRow> = {},
): AdminGuestRosterRsvpResponseRow {
  return {
    allergy_notes: "No nuts",
    extra_guests: 1,
    food_preference: "Fish",
    guest_id: "guest-1",
    last_submitted_at: "2026-05-18T10:00:00.000Z",
    plus_one_allergy_notes: "No almonds",
    plus_one_food_preference: "Vegetarian",
    ...overrides,
  };
}

test.describe("Admin Guest roster", () => {
  test("normalizes search params for the page Adapter", () => {
    expect(
      normalizeAdminGuestRosterFilters({
        q: ["  Ada  "],
        sort: "newest",
        status: "rsvp yes",
      }),
    ).toEqual({ query: "Ada", sort: "newest", status: "rsvp yes" });

    expect(
      normalizeAdminGuestRosterFilters({
        q: undefined,
        sort: "unknown",
        status: "deleted",
      }),
    ).toEqual({ query: "", sort: "name", status: "" });
  });

  test("projects Plus-one Guest RSVP details from tied Invited Guest RSVP", () => {
    const rows = buildAdminGuestRosterRows({
      activeInviteTokenRows: [{ guest_id: "plus-one-1" }],
      guestRows: [
        guestRow({
          full_name: "Invited Guest",
          id: "invited-1",
          plus_one_allowed: true,
          rsvp_status: "rsvp yes",
        }),
        guestRow({
          email: "plus-one@example.com",
          full_name: "Plus One Guest",
          guest_kind: "plus_one",
          id: "plus-one-1",
          invited_guest_id: "invited-1",
          phone: "+46700000002",
          rsvp_managed: true,
          rsvp_status: "rsvp yes",
          sms_opt_in: true,
        }),
      ],
      rsvpResponses: [rsvpResponseRow({ guest_id: "invited-1" })],
      tiedInvitedGuests: [{ full_name: "Invited Guest", id: "invited-1" }],
    });

    const invitedGuest = rows.find((row) => row.id === "invited-1");
    const plusOneGuest = rows.find((row) => row.id === "plus-one-1");

    expect(invitedGuest?.rsvpDetails).toMatchObject({
      allergyNotes: "No nuts",
      extraGuests: 1,
      foodPreference: "Fish",
    });
    expect(invitedGuest).toMatchObject({
      canEditIdentity: true,
      canEditPlusOneAllowed: true,
      canSave: true,
      guestKindLabel: "Invited Guest",
      inviteAccessScope: "full",
      rsvpStatusLabel: "rsvp yes",
      tiedInvitedGuestText: null,
    });

    expect(plusOneGuest).toMatchObject({
      canEditIdentity: false,
      canEditPlusOneAllowed: false,
      canEditSmsOptIn: false,
      canSave: false,
      guestKindLabel: "Plus-one Guest",
      hasActiveToken: true,
      inviteAccessScope: "scoped",
      rsvpStatusLabel: "rsvp yes",
      tiedInvitedGuestText: "Tied to Invited Guest",
    });
    expect(plusOneGuest?.rsvpDetails).toMatchObject({
      allergyNotes: "No almonds",
      extraGuests: 1,
      foodPreference: "Vegetarian",
    });
    expect(plusOneGuest?.rsvpDetails?.submittedAtLabel).toEqual(expect.any(String));
  });
});
