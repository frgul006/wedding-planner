import { expect, type Page } from "@playwright/test";

import {
  GUEST_NAVIGATION_COOKIE_NAME,
  hashGuestNavigationCookie,
} from "../lib/guest-navigation-session";

import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithGuests as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import { invitePathForToken } from "./support/urls";

async function getGuestNavigationCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === GUEST_NAVIGATION_COOKIE_NAME);
}

async function getGuestNavigationSessionByCookieValue(cookieValue: string) {
  const supabase = createE2eSupabaseAdminClient();
  const cookieHash = hashGuestNavigationCookie(cookieValue);
  const { data, error } = await supabase
    .from("guest_navigation_sessions")
    .select("cookie_hash, guest_id, invite_token_id, is_anonymous, wedding_id")
    .eq("cookie_hash", cookieHash)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

test.describe("guest navigation session attribution", () => {
  test("creates a secure opaque guest navigation cookie for a valid invite", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Navigation Cookie");
    const token = uniqueInviteToken("guest-navigation-cookie");
    const { guestId, tokenId } = await createInviteTestGuest({
      email: "e2e-guest-navigation@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();

    const cookie = await getGuestNavigationCookie(page);

    if (!cookie) {
      throw new Error("Expected valid invite to set a guest navigation cookie.");
    }

    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1_000);
    expect(cookie.value).not.toContain(token);
    expect(cookie.value).not.toContain(guestId);

    const session = await getGuestNavigationSessionByCookieValue(cookie.value);

    expect(session).toMatchObject({
      cookie_hash: hashGuestNavigationCookie(cookie.value),
      guest_id: guestId,
      invite_token_id: tokenId,
      is_anonymous: false,
      wedding_id: SEEDED_WEDDING_ID,
    });
    expect(session?.cookie_hash).not.toBe(cookie.value);
  });

  test("does not set a guest navigation cookie for invalid or missing invites", async ({
    page,
  }) => {
    await page.goto("/invite/not-a-real-invite-token");
    await expect(
      page.getByRole("heading", { name: "Invite link not valid" }),
    ).toBeVisible();
    expect(await getGuestNavigationCookie(page)).toBeUndefined();

    await page.goto("/invite");
    await expect(
      page.getByRole("heading", { name: "Invite link not valid" }),
    ).toBeVisible();
    expect(await getGuestNavigationCookie(page)).toBeUndefined();
  });
});
