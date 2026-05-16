import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  getInviteVisualFixture,
  seedInviteVisualFixtures,
} from "./support/invite-visual-fixtures";

type InviteVisualFixture = ReturnType<typeof getInviteVisualFixture>;

type InviteVisualState = {
  assertState: (page: Page, fixture: InviteVisualFixture) => Promise<void>;
  fixtureKey: string;
  heading: string;
  name: string;
  panelLabel: "Detaljer" | "OSA";
  title: string;
};

const screenshotViewport = { height: 844, width: 390 } as const;

async function waitForStableInviteVisuals(page: Page) {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function captureInviteVisualScreenshot(
  page: Page,
  testInfo: TestInfo,
  state: InviteVisualState,
) {
  const screenshotPath = testInfo.outputPath("invite-visual-qa", `${state.name}.png`);

  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(`${state.name}.png`, {
    contentType: "image/png",
    path: screenshotPath,
  });
}

async function assertActivePanelNavigation(
  page: Page,
  fixture: InviteVisualFixture,
  state: InviteVisualState,
) {
  const panel = page.locator(`#${fixture.primaryHash}`);

  await expect(panel, `${state.title} panel should be rendered`).toBeVisible();
  await expect(panel, `${state.title} deep link should scroll to its panel`).toBeInViewport();
  await expect(
    panel.getByRole("heading", { name: state.heading }),
    `${state.title} should expose the expected panel heading`,
  ).toBeVisible();
  await expect(
    panel.getByRole("link", { name: `Gå till ${state.panelLabel}` }),
    `${state.title} should mark the active dot for assistive tech`,
  ).toHaveAttribute("aria-current", "step");
}

const visualStates: InviteVisualState[] = [
  {
    assertState: async (page, fixture) => {
      await expect(
        page.getByText(`Personlig inbjudan för ${fixture.guest.fullName}`),
      ).toBeVisible();
      await expect(page.getByText("Sparat svar: Nej")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Uppdatera svar" }))
        .toBeVisible();
      await expect(page.getByRole("radio", { name: /^Nej\s+kan inte$/ }))
        .toBeChecked();
      await expect(page.getByRole("button", { name: "Spara ändringar" }))
        .toBeVisible();
    },
    fixtureKey: "rsvpNo",
    heading: "OSA",
    name: "rsvp-no-saved-osa",
    panelLabel: "OSA",
    title: "saved RSVP Nej",
  },
  {
    assertState: async (page, fixture) => {
      await expect(
        page.getByText(`Personlig inbjudan för ${fixture.guest.fullName}`),
      ).toBeVisible();
      await expect(page.getByText("Sparat svar: Kanske")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Uppdatera svar" }))
        .toBeVisible();
      await expect(page.getByRole("radio", { name: /^Kanske\s+återkommer$/ }))
        .toBeChecked();
      await expect(page.getByRole("button", { name: "Spara ändringar" }))
        .toBeVisible();
    },
    fixtureKey: "rsvpMaybe",
    heading: "OSA",
    name: "rsvp-maybe-saved-osa",
    panelLabel: "OSA",
    title: "saved RSVP Kanske",
  },
  {
    assertState: async (page, fixture) => {
      await expect(
        page.getByText(`Personlig inbjudan för ${fixture.guest.fullName}`),
      ).toBeVisible();
      await expect(page.getByText("Sparat svar: Ja")).toBeVisible();
      await expect(page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ }))
        .toBeChecked();
      await expect(page.getByRole("textbox", { name: "Namn" }))
        .toHaveValue(fixture.rsvp?.plusOneName ?? "");
      await expect(page.getByRole("textbox", { name: "Telefon" }).nth(1))
        .toHaveValue(fixture.rsvp?.plusOnePhone ?? "");
    },
    fixtureKey: "plusOneExpanded",
    heading: "OSA",
    name: "plus-one-expanded-osa",
    panelLabel: "OSA",
    title: "+1 expanded RSVP",
  },
  {
    assertState: async (page, fixture) => {
      await expect(
        page.getByText(`Personlig inbjudan för ${fixture.guest.fullName}`),
      ).toBeVisible();
      const updatesSection = page.locator("section", {
        has: page.getByRole("heading", { name: "Uppdateringar" }),
      });

      await expect(
        updatesSection.getByRole("heading", { name: "Visual Fixture: Transport" }),
      ).toBeVisible();
      await expect(
        updatesSection.getByText("Bussar avgår från hotellet kl. 15:45."),
      ).toBeVisible();
      await expect(updatesSection.getByRole("link", { name: "Öppna länk" }))
        .toHaveAttribute("href", "https://example.com/visual-transport");
    },
    fixtureKey: "updatesPublished",
    heading: "Detaljer",
    name: "updates-published-details",
    panelLabel: "Detaljer",
    title: "published update details",
  },
];

test.describe.serial("invite visual QA screenshots", () => {
  test.use({ viewport: screenshotViewport });

  test.beforeAll(async () => {
    await seedInviteVisualFixtures();
  });

  for (const state of visualStates) {
    test(`captures ${state.title} visual artifact`, async ({ page }, testInfo) => {
      const fixture = getInviteVisualFixture(state.fixtureKey);

      await page.goto(fixture.primaryPath);
      await waitForStableInviteVisuals(page);
      await expect(page).toHaveTitle(/Inbjudan/);
      await assertActivePanelNavigation(page, fixture, state);
      await state.assertState(page, fixture);
      await captureInviteVisualScreenshot(page, testInfo, state);
    });
  }
});
