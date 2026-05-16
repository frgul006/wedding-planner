import { expect, test } from "@playwright/test";

import {
  getInviteVisualFixture,
  seedInviteVisualFixtures,
} from "./support/invite-visual-fixtures";

test.describe.serial("invite cover visual states", () => {
  test.beforeEach(async () => {
    await seedInviteVisualFixtures();
  });

  test("shows explicit partner names, compact Swedish date, and details CTA before RSVP", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);

    const cover = page.locator("#inbjudan");
    await expect(cover).toBeVisible();
    await expect(cover.getByRole("heading", { name: "Fredrik & Matilda" }))
      .toBeVisible();
    await expect(cover.getByText("För Visual Fixture Updates", { exact: true }))
      .toBeVisible();
    await expect(cover.getByText("26 sept", { exact: true })).toBeVisible();
    await expect(cover.getByText("kl. 16:30", { exact: true })).toBeVisible();
    await expect(cover.getByText("Cicada", { exact: true })).toBeVisible();
    await expect(cover.getByText("Johanneshov", { exact: true })).toBeVisible();

    const primaryCta = cover.getByRole("link", { name: /^Öppna inbjudan/ });
    await expect(primaryCta).toHaveAttribute("href", "#detaljer");

    await primaryCta.click();
    await expect(page).toHaveURL(/#detaljer$/);
    await expect(page.locator("#detaljer")).toBeVisible();
  });

  test("shows saved answer treatment and an update CTA for existing RSVPs", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("rsvpNo");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);

    const cover = page.locator("#inbjudan");
    await expect(cover).toBeVisible();
    await expect(cover.getByText("Ditt svar", { exact: true })).toBeVisible();
    await expect(cover.getByText("Nej · jag kan tyvärr inte", { exact: true }))
      .toBeVisible();
    await expect(cover.getByText("Mottaget", { exact: true })).toBeVisible();

    const primaryCta = cover.getByRole("link", { name: /^Uppdatera svar/ });
    await expect(primaryCta).toHaveAttribute("href", "#osa");

    await primaryCta.click();
    await expect(page).toHaveURL(/#osa$/);
    await expect(page.locator("#osa")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Uppdatera svar" }))
      .toBeVisible();
  });
});
