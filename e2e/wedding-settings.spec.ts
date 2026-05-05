import { expect } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithWeddingSettings as test } from "./support/fixtures";
import { invitePathForToken } from "./support/urls";
import { uniqueE2eValue } from "./support/unique";
import { updateWeddingSettings } from "./support/wedding-settings";

test.describe("wedding settings propagation", () => {
  test("saves admin-managed wedding details and shows them on fresh invite loads", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Settings Propagation");
    const token = uniqueInviteToken("settings-propagation");
    const weddingName = uniqueE2eValue("E2E Wedding", "Settings Propagation");
    await createInviteTestGuest({
      email: "e2e-settings-propagation@example.com",
      fullName: guestName,
      token,
    });

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage settings" }).click();
    await expect(page.getByRole("heading", { name: "Wedding settings" })).toBeVisible();

    await page.getByLabel("Wedding name").fill(weddingName);
    await page.getByLabel("Wedding date and time").fill("2027-06-07T15:45");
    await page.getByLabel("Venue name").fill("E2E Glass House");
    await page.getByLabel("Venue address").fill("Regression Road 42, Testholm");
    await page.getByLabel("Google Maps URL").fill("https://maps.google.com/?q=e2e");
    await page.getByLabel("Spotify playlist URL").fill("https://open.spotify.com/playlist/e2e");
    await page
      .getByLabel("Time plan")
      .fill("15:45 - Doors open\n16:30 - Ceremony\n19:00 - Dinner");
    await page
      .getByLabel("Policy / dress code")
      .fill("E2E dress code: festive regression.");
    await page.getByLabel("Gift information").fill("E2E gift info from settings.");
    await page.getByRole("button", { name: "Save wedding settings" }).click();

    await expect(page.getByText("Wedding settings updated.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Wedding name")).toHaveValue(weddingName);
    await expect(page.getByLabel("Venue name")).toHaveValue("E2E Glass House");
    await expect(page.getByLabel("Venue address")).toHaveValue(
      "Regression Road 42, Testholm",
    );
    await expect(page.getByLabel("Time plan")).toHaveValue(
      "15:45 - Doors open\n16:30 - Ceremony\n19:00 - Dinner",
    );

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: weddingName })).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "When" }) })
        .getByText(/2027/),
    ).toBeVisible();
    await expect(page.getByText("E2E Glass House", { exact: true })).toBeVisible();
    await expect(page.getByText("Regression Road 42, Testholm", { exact: true }))
      .toBeVisible();
    await expect(page.getByText("15:45 - Doors open")).toBeVisible();
    await expect(page.getByText("16:30 - Ceremony")).toBeVisible();
    await expect(page.getByText("19:00 - Dinner")).toBeVisible();
    await expect(page.getByText("E2E dress code: festive regression.")).toBeVisible();
    await expect(page.getByText("E2E gift info from settings.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute(
      "href",
      "https://maps.google.com/?q=e2e",
    );
    await expect(page.getByRole("link", { name: "Open Spotify playlist" }))
      .toHaveAttribute("href", "https://open.spotify.com/playlist/e2e");
  });

  test("shows Coming soon placeholders when optional invite settings are missing", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Minimal Settings");
    const token = uniqueInviteToken("minimal-settings");
    await updateWeddingSettings({
      gift_info: null,
      google_maps_url: null,
      name: "E2E Minimal Wedding",
      policy: null,
      spotify_playlist_url: null,
      time_plan: [],
      venue_address: null,
      venue_name: null,
      wedding_date: null,
    });
    await createInviteTestGuest({
      email: "e2e-minimal-settings@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByRole("heading", { name: "E2E Minimal Wedding" })).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "When" }) })
        .getByText("Coming soon"),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Venue" }) })
        .getByText("Coming soon")
        .first(),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Time plan" }) })
        .getByText("Coming soon"),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Policy / dress code" }) })
        .getByText("Coming soon"),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Gift information" }) })
        .getByText("Coming soon"),
    ).toBeVisible();
    await expect(page.getByText("Google Maps link coming soon")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Spotify playlist" })).toHaveCount(0);
  });
});
