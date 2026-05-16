import { expect } from "@playwright/test";

import { testWithWeddingSettings as test } from "./support/fixtures";
import { SEEDED_GUESTS } from "./support/test-data";
import { updateWeddingSettings } from "./support/wedding-settings";

test.describe("invalid invite link visual state", () => {
  test("shows configured wedding support contact without guest or event logistics", async ({ page }) => {
    await page.goto("/invite/not-a-real-token");

    await expect(page.getByRole("heading", { name: "Inbjudan saknas" }))
      .toBeVisible();
    await expect(page.getByText("Den här länken", { exact: true })).toBeVisible();
    await expect(page.getByText("fungerade inte.", { exact: true })).toBeVisible();
    await expect(page.getByText("Hör av dig till Fredrik & Matilda så skickar de en ny."))
      .toBeVisible();
    const contactSection = page.locator("section", { hasText: "Kontakt" });
    await expect(contactSection.getByText("Kontakt", { exact: true })).toBeVisible();
    await expect(contactSection.getByText("Fredrik & Matilda", { exact: true }))
      .toBeVisible();
    await expect(contactSection.getByRole("link", { name: "osa@example.com" }))
      .toHaveAttribute("href", "mailto:osa@example.com");

    await expect(page.getByText(SEEDED_GUESTS.firstTimeRsvp.name)).toHaveCount(0);
    await expect(page.getByText(SEEDED_GUESTS.existingRsvp.name)).toHaveCount(0);
    await expect(page.getByText("Fredrik <3 Matilda")).toHaveCount(0);
    await expect(page.getByText("Cicada")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit RSVP" })).toHaveCount(0);
  });

  test("uses the configured support contact on the missing-token route", async ({
    page,
  }) => {
    await page.goto("/invite");

    await expect(page.getByRole("heading", { name: "Inbjudan saknas" }))
      .toBeVisible();
    await expect(page.getByText("Hör av dig till Fredrik & Matilda så skickar de en ny."))
      .toBeVisible();
    await expect(page.getByRole("link", { name: "osa@example.com" }))
      .toHaveAttribute("href", "mailto:osa@example.com");
  });

  test("shows a generic fallback when no support contact is configured", async ({
    page,
  }) => {
    await updateWeddingSettings({ invite_support_email: null });

    await page.goto("/invite/not-a-real-token");

    await expect(page.getByRole("heading", { name: "Inbjudan saknas" }))
      .toBeVisible();
    await expect(page.getByText("Be värdparet om en ny länk.")).toBeVisible();
    await expect(page.getByText("Kontakt", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Fredrik & Matilda", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "osa@example.com" })).toHaveCount(0);
  });
});
