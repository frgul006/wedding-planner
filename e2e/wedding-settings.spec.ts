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
  test("rejects invalid Time Plan rows", async ({ page }) => {
    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage settings" }).click();
    await expect(page.getByRole("heading", { name: "Wedding settings" })).toBeVisible();

    await page.getByLabel("Time plan").fill("16:30 - Välkomstdrinkar\nMingel hela kvällen");
    await page.getByRole("button", { name: "Save wedding settings" }).click();

    await expect(
      page.getByText(
        "Each Time Plan row needs a valid time and label, like 16:30 - Välkomstdrinkar.",
      ),
    ).toBeVisible();
  });

  test("rejects unsafe guest-facing Wedding settings links", async ({ page }) => {
    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage settings" }).click();
    await expect(page.getByRole("heading", { name: "Wedding settings" })).toBeVisible();

    await page.getByLabel("Google Maps URL").fill("ftp://maps.example.test/place");
    await page.getByRole("button", { name: "Save wedding settings" }).click();
    await expect(page.getByText("Google Maps URL must start with http:// or https://."))
      .toBeVisible();

    await page.getByLabel("Google Maps URL").fill("https://maps.example.test/place");
    await page.getByLabel("Spotify playlist URL").fill("ftp://spotify.example.test/list");
    await page.getByRole("button", { name: "Save wedding settings" }).click();
    await expect(page.getByText("Spotify playlist URL must start with http:// or https://."))
      .toBeVisible();
  });

  test("persists photo review setting while anonymous hub uploads stay open by default", async ({
    page,
  }) => {
    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage settings" }).click();
    await expect(page.getByRole("heading", { name: "Wedding settings" })).toBeVisible();

    const anonymousUploadToggle = page.getByLabel("Allow anonymous wedding hub uploads");
    const reviewToggle = page.getByLabel("Require photo review before showing uploads");

    await expect(anonymousUploadToggle).toBeChecked();
    await expect(reviewToggle).not.toBeChecked();

    await reviewToggle.check();
    await page.getByRole("button", { name: "Save wedding settings" }).click();

    await expect(page.getByText("Wedding settings updated.")).toBeVisible();

    await page.reload();
    await expect(anonymousUploadToggle).toBeChecked();
    await expect(reviewToggle).toBeChecked();
  });

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
    await expect(
      page.getByText(
        "Leave blank to show a safe public placeholder instead of guessing from the wedding name.",
      ),
    ).toHaveCount(2);

    await page.getByLabel("Wedding name").fill(weddingName);
    await page.getByLabel("Partner one name").fill("E2E Fredrik");
    await page.getByLabel("Partner two name").fill("E2E Matilda");
    await page.getByLabel("Wedding date and time").fill("2027-06-07T15:45");
    await page.getByLabel("Venue name").fill("E2E Glass House");
    await page.getByLabel("Venue address").fill("Regression Road 42, Testholm");
    await page.getByLabel("Venue area / city").fill("E2E Testholm");
    await page.getByLabel("Google Maps URL").fill("https://maps.google.com/?q=e2e");
    await page.getByLabel("Spotify playlist URL").fill("https://open.spotify.com/playlist/e2e");
    await page.getByLabel("Invite support email").fill("support-e2e@example.com");
    await page
      .getByLabel("Time plan")
      .fill("15:45 - Doors open\n16:30 - Ceremony\n19:00 - Dinner");
    await page.getByLabel("Dress code").fill("E2E dress code: festive regression.");
    await page.getByLabel("Child policy").fill("E2E child policy from settings.");
    await page.getByLabel("Legacy policy notes").fill("E2E legacy policy from settings.");
    await page
      .getByLabel("Food & drink information")
      .fill("E2E food and drink from settings.");
    await page.getByLabel("Gift information").fill("E2E gift info from settings.");
    await page.getByRole("button", { name: "Save wedding settings" }).click();

    await expect(page.getByText("Wedding settings updated.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Wedding name")).toHaveValue(weddingName);
    await expect(page.getByLabel("Partner one name")).toHaveValue("E2E Fredrik");
    await expect(page.getByLabel("Partner two name")).toHaveValue("E2E Matilda");
    await expect(page.getByLabel("Venue name")).toHaveValue("E2E Glass House");
    await expect(page.getByLabel("Venue address")).toHaveValue(
      "Regression Road 42, Testholm",
    );
    await expect(page.getByLabel("Venue area / city")).toHaveValue("E2E Testholm");
    await expect(page.getByLabel("Invite support email")).toHaveValue(
      "support-e2e@example.com",
    );
    await expect(page.getByLabel("Time plan")).toHaveValue(
      "15:45 - Doors open\n16:30 - Ceremony\n19:00 - Dinner",
    );
    await expect(page.getByLabel("Food & drink information")).toHaveValue(
      "E2E food and drink from settings.",
    );

    await page.goto(invitePathForToken(token));
    const coverPanel = page.locator("#inbjudan");
    await expect(page.getByText(`Inbjudan till ${guestName}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Fredrik & E2E Matilda" })).toBeVisible();
    await expect(coverPanel.getByText("kl. 15:45", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: /^Öppna inbjudan/ }).click();
    await expect(page).toHaveURL(/#detaljer$/);
    const detailsPanel = page.locator("#detaljer");
    await expect(
      detailsPanel.locator("section", { hasText: "Plats" }).getByText(/2027/),
    ).toBeVisible();
    await expect(detailsPanel.getByText("E2E Glass House", { exact: true })).toBeVisible();
    await expect(detailsPanel.getByText("E2E Testholm", { exact: true }).first()).toBeVisible();
    await expect(detailsPanel.getByText("Regression Road 42, Testholm", { exact: true }))
      .toBeVisible();
    await expect(detailsPanel.getByText("15:45 - Doors open")).toBeVisible();
    await expect(detailsPanel.getByText("16:30 - Ceremony")).toBeVisible();
    await expect(detailsPanel.getByText("19:00 - Dinner")).toBeVisible();
    await expect(detailsPanel.getByText("E2E dress code: festive regression.")).toBeVisible();
    await expect(detailsPanel.getByRole("heading", { name: "Mat & dryck" })).toBeVisible();
    await expect(detailsPanel.getByText("E2E food and drink from settings.")).toBeVisible();
    await expect(detailsPanel.getByRole("heading", { name: "Barn" })).toBeVisible();
    await expect(detailsPanel.getByText("E2E child policy from settings.")).toBeVisible();
    await expect(detailsPanel.getByText("E2E legacy policy from settings.")).toHaveCount(0);
    await expect(detailsPanel.getByText("E2E gift info from settings.")).toBeVisible();
    await expect(detailsPanel.getByRole("link", { name: "Visa karta" })).toHaveAttribute(
      "href",
      "https://maps.google.com/?q=e2e",
    );
    await expect(detailsPanel.getByRole("link", { name: "Öppna Spotify" }))
      .toHaveAttribute("href", "https://open.spotify.com/playlist/e2e");
  });

  test("shows Swedish placeholders when optional invite settings are missing", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Minimal Settings");
    const token = uniqueInviteToken("minimal-settings");
    await updateWeddingSettings({
      child_policy: null,
      dress_code: null,
      food_and_drink_info: null,
      gift_info: null,
      google_maps_url: null,
      invite_support_email: null,
      name: "E2E Minimal Wedding",
      partner_one_name: null,
      partner_two_name: "E2E Partner Two",
      policy: null,
      spotify_playlist_url: null,
      time_plan: [],
      venue_address: null,
      venue_area: null,
      venue_name: null,
      wedding_date: null,
    });
    await createInviteTestGuest({
      email: "e2e-minimal-settings@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByRole("heading", { name: "Partner 1 & E2E Partner Two" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Minimal Wedding" })).toHaveCount(0);

    await page.getByRole("link", { name: /^Öppna inbjudan/ }).click();
    await expect(page).toHaveURL(/#detaljer$/);
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Plats" }) })
        .getByText("Kommer snart")
        .first(),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Tidsplan" }) })
        .getByText("Kommer snart"),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Klädkod" }) })
        .getByText("Kommer snart"),
    ).toBeVisible();
    await expect(
      page
        .locator("section", { has: page.getByRole("heading", { name: "Mat & dryck" }) })
        .getByText("Kommer snart"),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Gåvor" }) })
        .getByText("Kommer snart"),
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Musik" }) })
        .getByText("Kommer snart"),
    ).toBeVisible();
    await expect(page.getByText("Kartlänk kommer snart")).toBeVisible();
    await expect(page.getByRole("link", { name: "Visa karta" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Öppna Spotify" })).toHaveCount(0);
  });
});
