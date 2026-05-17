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

    await page.setViewportSize({ height: 1080, width: 390 });
    await page.goto(fixture.path);

    const cover = page.locator("#inbjudan");
    const coverCard = cover.locator("section[aria-label='Inbjudan']");
    await expect(cover).toBeVisible();
    await expect(coverCard).toBeVisible();
    await expect
      .poll(async () => {
        const box = await coverCard.boundingBox();
        return box ? { width: Math.round(box.width), x: Math.round(box.x) } : null;
      })
      .toEqual({ width: 350, x: 20 });
    await expect
      .poll(async () => Math.round((await coverCard.boundingBox())?.y ?? 0))
      .toBeLessThanOrEqual(56);
    await expect
      .poll(async () => Math.round((await coverCard.boundingBox())?.height ?? 0))
      .toBeLessThanOrEqual(510);
    await expect(page.locator("a[aria-label='Till inbjudan']"))
      .toHaveText("F & M · 01/03");
    await expect(cover.getByRole("heading", { name: "Fredrik & Matilda" }))
      .toBeVisible();
    await expect(coverCard.getByText("Inbjudan", { exact: true })).toBeVisible();
    await expect(coverCard.getByText("till Visual Fixture Updates", { exact: true }))
      .toBeVisible();
    await expect(coverCard.getByText("Bröllopsfest", { exact: true })).toBeVisible();
    await expect(coverCard.getByText("Bröllopsinbjudan", { exact: true }))
      .toHaveCount(0);
    await expect(coverCard.getByText("För Visual Fixture Updates", { exact: true }))
      .toHaveCount(0);
    await expect(cover.getByText("❦", { exact: true })).toBeVisible();
    await expect(cover.getByText("❀", { exact: true })).toBeVisible();
    await expect(cover.getByText("26 sept", { exact: true })).toBeVisible();
    await expect(cover.getByText("kl. 16:30", { exact: true })).toBeVisible();
    await expect(cover.getByText("Cicada", { exact: true })).toBeVisible();
    await expect(cover.getByText("Johanneshov", { exact: true })).toBeVisible();

    await expect(
      cover.getByText("Tre sidor · svep eller tryck på prickarna ovan", { exact: true }),
    ).toHaveCount(0);

    const primaryCta = cover.getByRole("link", { name: /^Öppna inbjudan/ });
    await expect(primaryCta).toHaveAttribute("href", "#detaljer");
    await expect
      .poll(async () => Math.round((await page.getByRole("button", { name: "Nästa panel" }).boundingBox())?.y ?? 0))
      .toBeGreaterThanOrEqual(890);

    await primaryCta.click();
    await expect(page).toHaveURL(/#detaljer$/);
    await expect(page.locator("#detaljer")).toBeVisible();
  });

  test("shows saved answer treatment and an update CTA for existing RSVPs", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("rsvpNo");

    await page.setViewportSize({ height: 1080, width: 390 });
    await page.goto(fixture.path);

    const cover = page.locator("#inbjudan");
    await expect(cover).toBeVisible();
    await expect(cover.getByText("Ditt svar", { exact: true })).toBeVisible();
    const savedAnswerText = cover.getByText("Nej · jag kan tyvärr inte", { exact: true });
    await expect(savedAnswerText).toBeVisible();
    await expect
      .poll(async () => Math.round((await savedAnswerText.boundingBox())?.height ?? 0))
      .toBeLessThanOrEqual(32);
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
