import { expect, test } from "@playwright/test";

import type { GrantedInviteAccessWithRsvp, InviteRsvpResponse } from "../lib/invite-access";
import {
  createInviteCalendarFile,
  getInviteCalendarActionHref,
  isInviteCalendarEligible,
} from "../lib/invite-calendar";
import { RSVP_ATTENDANCE, type RsvpAttendance } from "../lib/rsvp-attendance";
import { testWithWeddingSettings } from "./support/fixtures";
import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { invitePathForToken } from "./support/urls";
import { updateWeddingSettings } from "./support/wedding-settings";

function makeRsvpResponse(attendance: RsvpAttendance): InviteRsvpResponse {
  return {
    allergy_notes: null,
    attendance,
    extra_guests: 0,
    food_preference: null,
    last_submitted_at: "2026-06-22T10:00:00.000Z",
    plus_one_allergy_notes: null,
    plus_one_email: null,
    plus_one_food_preference: null,
    plus_one_name: null,
    plus_one_phone: null,
    plus_one_sms_opt_in: false,
  };
}

function makeAccess({
  accessScope = "full",
  attendance = RSVP_ATTENDANCE.yes,
  weddingEndDate = "2027-06-07T21:00:00.000Z",
}: {
  accessScope?: "full" | "scoped";
  attendance?: RsvpAttendance | null;
  weddingEndDate?: string | null;
} = {}): GrantedInviteAccessWithRsvp {
  return {
    accessScope,
    canSubmitRsvp: accessScope === "full",
    guest: {
      full_name: accessScope === "scoped" ? "E2E Plus One" : "E2E Invited Guest",
      phone: null,
      plus_one_allowed: false,
      sms_opt_in: false,
    },
    guestId: `${accessScope}-guest-id`,
    inviteTokenId: `${accessScope}-token-id`,
    rsvpResponse: attendance ? makeRsvpResponse(attendance) : null,
    status: "granted",
    wedding: {
      child_policy: null,
      dress_code: null,
      gift_info: null,
      google_maps_url: "https://maps.test/p",
      invite_support_email: null,
      name: "Fredrik & Matilda Wedding",
      partner_one_name: "Fredrik",
      partner_two_name: "Matilda",
      policy: null,
      spotify_playlist_url: null,
      time_plan: [],
      venue_address: "Regression Road 42",
      venue_area: "Testholm",
      venue_name: "Glass House",
      wedding_date: "2027-06-07T13:45:00.000Z",
      wedding_end_date: weddingEndDate,
    },
    weddingId: "wedding-id",
  };
}

function unfoldCalendarFile(value: string) {
  return value.replace(/\r\n /g, "");
}

test.describe("Invite Calendar action helpers", () => {
  test("builds an ICS file with Invite link, safe map link, location, and reminders", () => {
    const calendarFile = createInviteCalendarFile({
      access: makeAccess(),
      inviteUrl: "https://wed.test/i/t",
      now: new Date("2026-06-22T10:00:00.000Z"),
    });

    expect(calendarFile).not.toBeNull();

    const unfolded = unfoldCalendarFile(calendarFile ?? "");

    expect(unfolded).toContain("BEGIN:VCALENDAR");
    expect(unfolded).toContain("DTSTAMP:20260622T100000Z");
    expect(unfolded).toContain("DTSTART:20270607T134500Z");
    expect(unfolded).toContain("DTEND:20270607T210000Z");
    expect(unfolded).toContain("SUMMARY:Fredrik & Matilda Wedding");
    expect(unfolded).toContain("LOCATION:Glass House\\, Regression Road 42\\, Testholm");
    expect(unfolded).toContain(
      "DESCRIPTION:Vi ser fram emot att fira tillsammans.\\nInbjudan: https://wed.test/i/t\\nKarta: https://maps.test/p",
    );
    expect(unfolded).toContain("URL:https://wed.test/i/t");
    expect(unfolded.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(unfolded).toContain("TRIGGER:-P7D");
    expect(unfolded).toContain("TRIGGER:-P1D");
  });

  test("applies Invite and RSVP eligibility rules", () => {
    expect(isInviteCalendarEligible(makeAccess({ attendance: null }))).toBe(false);
    expect(isInviteCalendarEligible(makeAccess({ attendance: RSVP_ATTENDANCE.no }))).toBe(false);
    expect(isInviteCalendarEligible(makeAccess({ attendance: RSVP_ATTENDANCE.maybe }))).toBe(true);
    expect(
      isInviteCalendarEligible(makeAccess({ accessScope: "scoped", attendance: null })),
    ).toBe(true);
    expect(isInviteCalendarEligible(makeAccess({ weddingEndDate: null }))).toBe(false);
    expect(
      getInviteCalendarActionHref({ access: makeAccess(), rawToken: "token with spaces" }),
    ).toBe("/invite/token%20with%20spaces/calendar.ics");
  });
});

testWithWeddingSettings("shows and serves the Calendar action for an RSVP yes Invite", async ({
  page,
}) => {
  const token = uniqueInviteToken("calendar-action-ui");

  await updateWeddingSettings({ wedding_end_date: "2026-09-26T23:00:00.000Z" });
  await createInviteTestGuest({
    attendance: RSVP_ATTENDANCE.yes,
    fullName: uniqueRsvpGuestName("Calendar Action UI"),
    token,
  });

  await page.goto(`${invitePathForToken(token)}#detaljer`);

  const calendarAction = page.getByRole("link", { name: "Lägg till i kalender" });
  await expect(calendarAction).toBeVisible();
  await expect(calendarAction).toHaveAttribute(
    "href",
    `${invitePathForToken(token)}/calendar.ics`,
  );

  const response = await page.request.get(`${invitePathForToken(token)}/calendar.ics`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");

  const calendarFile = unfoldCalendarFile(await response.text());
  expect(calendarFile).toContain("SUMMARY:Fredrik <3 Matilda");
  expect(calendarFile).toContain("Inbjudan: http");
  expect(calendarFile).toContain(invitePathForToken(token));
});
