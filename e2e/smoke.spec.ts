import { expect, test } from "@playwright/test";

import { signOutAdmin } from "./support/auth";
import { SEEDED_ADMIN, SEEDED_GUESTS } from "./support/test-data";
import { invitePathForToken } from "./support/urls";

test.describe("admin auth smoke", () => {
  test("guards admin routes and supports seeded admin login/logout", async ({ page }) => {
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin$/);
    await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();

    await page.getByLabel("Email").fill(SEEDED_ADMIN.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password.", { exact: true }))
      .toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.getByLabel("Email").fill(SEEDED_ADMIN.email);
    await page.getByLabel("Password").fill(SEEDED_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
    await expect(page.getByText("Signed in as Local Admin.")).toBeVisible();

    await signOutAdmin(page);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin$/);
  });
});

test.describe("public invite safety smoke", () => {
  for (const path of ["/invite", "/invite/not-a-real-token"] as const) {
    test(`${path} shows the safe invalid invite page`, async ({ page }) => {
      await page.goto(path);

      await expect(
        page.getByRole("heading", { name: "Inbjudan saknas" }),
      ).toBeVisible();
      await expect(page.getByText("Den här länken", { exact: true })).toBeVisible();
      await expect(page.getByText("fungerade inte.", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "osa@example.com" }))
        .toHaveAttribute("href", "mailto:osa@example.com");
      await expect(page.getByText(SEEDED_GUESTS.firstTimeRsvp.name)).toHaveCount(0);
      await expect(page.getByText(SEEDED_GUESTS.existingRsvp.name)).toHaveCount(0);
      await expect(page.getByText("Fredrik <3 Matilda")).toHaveCount(0);
      await expect(page.getByText("Cicada")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Submit RSVP" })).toHaveCount(0);
    });
  }
});

test.describe("valid invite smoke", () => {
  test("shows saved answer treatment for an existing RSVP", async ({ page }) => {
    await page.goto(invitePathForToken(SEEDED_GUESTS.existingRsvp.token));

    await expect(
      page.getByText(`Inbjudan till ${SEEDED_GUESTS.existingRsvp.name}`),
    ).toBeVisible();
    await expect(page.getByText("Ditt svar", { exact: true })).toBeVisible();
    await expect(page.getByText("Ja · jag kommer gärna", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Uppdatera svar/ })).toBeVisible();
  });

  test("shows seeded wedding details and RSVP entry points", async ({ page }) => {
    await page.goto(invitePathForToken(SEEDED_GUESTS.firstTimeRsvp.token));

    await expect(
      page.getByText(`Inbjudan till ${SEEDED_GUESTS.firstTimeRsvp.name}`),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fredrik & Matilda" }))
      .toBeVisible();

    await expect(page.getByRole("link", { name: "Gå till Inbjudan" }))
      .toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("link", { name: "Gå till Detaljer" }))
      .toHaveAttribute("href", "#detaljer");
    await expect(page.getByRole("link", { name: /^Öppna inbjudan/ })).toHaveAttribute(
      "href",
      "#detaljer",
    );

    await page.getByRole("link", { name: /^Öppna inbjudan/ }).click();
    await expect(page).toHaveURL(/#detaljer$/);
    const detailsPanel = page.locator("#detaljer");
    await expect(detailsPanel.getByText("Cicada", { exact: true })).toBeVisible();
    await expect(detailsPanel.getByText("Veterinärgränd 6, Johanneshov", { exact: true }))
      .toBeVisible();
    await expect(detailsPanel.getByText("16:30 - Välkomstdrinkar")).toBeVisible();
    await expect(detailsPanel.getByText("18:30 - Middag")).toBeVisible();
    await expect(detailsPanel.getByText("21:00 - Fest")).toBeVisible();
    await expect(detailsPanel.getByText("Klädkod: festlig sommarformal")).toBeVisible();
    await expect(detailsPanel.getByText("Din närvaro är den bästa presenten.")).toBeVisible();

    await expect(detailsPanel.getByRole("link", { name: "Visa karta" }))
      .toHaveAttribute("target", "_blank");
    await expect(detailsPanel.getByRole("link", { name: "Öppna Spotify" }))
      .toHaveAttribute("target", "_blank");
    const updatesSection = detailsPanel.locator("section", {
      hasText: "Uppdateringar",
    });
    await expect(
      updatesSection.getByRole("heading", { name: "Visual Fixture: Transport" }),
    ).toBeVisible();
    await expect(
      updatesSection.getByText("Bussar avgår från hotellet kl. 15:45."),
    ).toBeVisible();

    await page.getByRole("link", { name: "Vidare till OSA" }).click();
    await expect(page).toHaveURL(/#osa$/);
    await expect(page.getByRole("button", { name: "Skicka mitt svar →" })).toBeVisible();
  });
});
