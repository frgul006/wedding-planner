import { expect, test } from "@playwright/test";

import {
  getInviteRsvpEditHrefFromLocation,
  getInviteRsvpSubmittedHref,
  isInviteRsvpClientActionAcceptHeader,
  shouldShowInviteRsvpSubmittedConfirmation,
} from "../lib/invite-rsvp-navigation";

test.describe("Invite RSVP navigation", () => {
  test("builds the canonical submitted confirmation href", () => {
    expect(getInviteRsvpSubmittedHref("raw token/with spaces")).toBe(
      "/invite/raw%20token%2Fwith%20spaces?rsvp_status=submitted#osa",
    );
  });

  test("detects the submitted confirmation search param", () => {
    expect(
      shouldShowInviteRsvpSubmittedConfirmation({ rsvp_status: "submitted" }),
    ).toBe(true);
    expect(
      shouldShowInviteRsvpSubmittedConfirmation({
        rsvp_status: ["submitted", "ignored"],
      }),
    ).toBe(true);
    expect(
      shouldShowInviteRsvpSubmittedConfirmation({ rsvp_status: "draft" }),
    ).toBe(false);
    expect(shouldShowInviteRsvpSubmittedConfirmation({})).toBe(false);
  });

  test("clears the submitted marker when returning to edit mode", () => {
    expect(
      getInviteRsvpEditHrefFromLocation({
        pathname: "/invite/raw-token",
        search: "?rsvp_status=submitted",
      }),
    ).toBe("/invite/raw-token#osa");

    expect(
      getInviteRsvpEditHrefFromLocation({
        pathname: "/invite/raw-token",
        search: "?rsvp_status=submitted&preview=1",
      }),
    ).toBe("/invite/raw-token?preview=1#osa");
  });

  test("detects client action accept headers", () => {
    expect(isInviteRsvpClientActionAcceptHeader("text/x-component")).toBe(true);
    expect(
      isInviteRsvpClientActionAcceptHeader("text/html, text/x-component"),
    ).toBe(true);
    expect(isInviteRsvpClientActionAcceptHeader("text/html")).toBe(false);
    expect(isInviteRsvpClientActionAcceptHeader(null)).toBe(false);
  });
});
