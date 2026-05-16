import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  getInviteVisualFixture,
  invalidateInviteVisualFixtureToken,
  seedInviteVisualFixtures,
} from "./support/invite-visual-fixtures";

type InviteVisualFixture = ReturnType<typeof getInviteVisualFixture>;
type InviteVisualStateCleanup = () => Promise<void> | void;

type InviteVisualState = {
  assertState: (page: Page, fixture: InviteVisualFixture) => Promise<void>;
  fixtureKey: string;
  heading: string;
  name: string;
  panelLabel: "Detaljer" | "Inbjudan" | "OSA";
  prepareState?: (
    page: Page,
    fixture: InviteVisualFixture,
  ) => Promise<InviteVisualStateCleanup | void>;
  primaryHash?: "detaljer" | "inbjudan" | "osa";
  title: string;
};

const screenshotViewport = { height: 1080, width: 390 } as const;
const inviteRoutePattern = "**/invite/**";

const transientRsvpValues = {
  saveError: {
    foodPreference: "Save-error vegetarisk meny",
    phone: "+46700000992",
  },
  submitting: {
    foodPreference: "Skickar vegetarisk meny",
    phone: "+46700000991",
  },
} as const;

async function waitForStableInviteVisuals(page: Page) {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-dev-tools-button],
      [data-nextjs-dev-tools-panel],
      [data-nextjs-dialog-overlay],
      [data-nextjs-toast] {
        display: none !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function captureNamedInviteVisualScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const screenshotPath = testInfo.outputPath("invite-visual-qa", `${name}.png`);

  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(`${name}.png`, {
    contentType: "image/png",
    path: screenshotPath,
  });
}

async function captureInviteVisualScreenshot(
  page: Page,
  testInfo: TestInfo,
  state: InviteVisualState,
) {
  await captureNamedInviteVisualScreenshot(page, testInfo, state.name);
}

async function fillRsvpVisualValues(
  page: Page,
  values: { foodPreference: string; phone: string },
) {
  await page.getByRole("textbox", { name: "Telefon" }).first().fill(values.phone);
  await page.getByRole("textbox", { name: "Matpreferens" }).first().fill(
    values.foodPreference,
  );
}

async function assertRsvpVisualValues(
  page: Page,
  values: { foodPreference: string; phone: string },
) {
  await expect(page.getByRole("textbox", { name: "Telefon" }).first()).toHaveValue(
    values.phone,
  );
  await expect(page.getByRole("textbox", { name: "Matpreferens" }).first()).toHaveValue(
    values.foodPreference,
  );
}

async function delayNextInvitePost(page: Page) {
  let releaseSubmit: (() => void) | null = null;
  let resolveSubmitStarted!: () => void;
  let hasHandledPost = false;
  const submitStarted = new Promise<void>((resolve) => {
    resolveSubmitStarted = resolve;
  });

  await page.route(inviteRoutePattern, async (route) => {
    if (route.request().method() !== "POST" || hasHandledPost) {
      await route.continue();
      return;
    }

    hasHandledPost = true;
    resolveSubmitStarted();
    await new Promise<void>((resume) => {
      releaseSubmit = resume;
    });
    await route.continue();
  });

  return {
    release() {
      if (!releaseSubmit) {
        throw new Error("Invite POST was not intercepted before release.");
      }

      releaseSubmit();
    },
    submitStarted,
  };
}

async function failNextInvitePostWithInvalidatedToken(
  page: Page,
  fixture: InviteVisualFixture,
) {
  let hasHandledPost = false;

  await page.route(inviteRoutePattern, async (route) => {
    if (route.request().method() !== "POST" || hasHandledPost) {
      await route.continue();
      return;
    }

    hasHandledPost = true;
    await invalidateInviteVisualFixtureToken(fixture);
    const response = await route.fetch();
    await route.fulfill({ response });
  });
}

async function assertActivePanelNavigation(
  page: Page,
  fixture: InviteVisualFixture,
  state: InviteVisualState,
) {
  const primaryHash = state.primaryHash ?? fixture.primaryHash;
  const panel = page.locator(`#${primaryHash}`);

  await expect(panel, `${state.title} panel should be rendered`).toBeVisible();
  await expect(panel, `${state.title} deep link should scroll to its panel`).toBeInViewport();
  await expect(
    panel.getByRole("heading", { name: state.heading }),
    `${state.title} should expose the expected panel heading`,
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: `Gå till ${state.panelLabel}` }),
    `${state.title} should mark the active dot for assistive tech`,
  ).toHaveAttribute("aria-current", "step");
}

const visualStates: InviteVisualState[] = [
  {
    assertState: async (page) => {
      const cover = page.locator("#inbjudan");

      await expect(cover.getByText("För Visual Fixture Updates", { exact: true }))
        .toBeVisible();
      await expect(cover.getByText("26 sept", { exact: true })).toBeVisible();
      await expect(cover.getByText("kl. 16:30", { exact: true })).toBeVisible();
      await expect(cover.getByRole("link", { name: /^Öppna inbjudan/ }))
        .toHaveAttribute("href", "#detaljer");
    },
    fixtureKey: "updatesPublished",
    heading: "Fredrik & Matilda",
    name: "opened-no-answer-cover",
    panelLabel: "Inbjudan",
    primaryHash: "inbjudan",
    title: "opened no-answer cover",
  },
  {
    assertState: async (page) => {
      const cover = page.locator("#inbjudan");

      await expect(cover.getByText("Ditt svar", { exact: true })).toBeVisible();
      await expect(cover.getByText("Ja · jag kommer gärna", { exact: true }))
        .toBeVisible();
      await expect(cover.getByText("Mottaget", { exact: true })).toBeVisible();
      await expect(cover.getByRole("link", { name: /^Uppdatera svar/ }))
        .toHaveAttribute("href", "#osa");
    },
    fixtureKey: "plusOneExpanded",
    heading: "Fredrik & Matilda",
    name: "rsvp-ja-saved-cover",
    panelLabel: "Inbjudan",
    primaryHash: "inbjudan",
    title: "saved RSVP Ja cover",
  },
  {
    assertState: async (page) => {
      const cover = page.locator("#inbjudan");

      await expect(cover.getByText("Ditt svar", { exact: true })).toBeVisible();
      await expect(cover.getByText("Nej · jag kan tyvärr inte", { exact: true }))
        .toBeVisible();
      await expect(cover.getByText("Mottaget", { exact: true })).toBeVisible();
      await expect(cover.getByRole("link", { name: /^Uppdatera svar/ }))
        .toHaveAttribute("href", "#osa");
    },
    fixtureKey: "rsvpNo",
    heading: "Fredrik & Matilda",
    name: "rsvp-no-saved-cover",
    panelLabel: "Inbjudan",
    primaryHash: "inbjudan",
    title: "saved RSVP Nej cover",
  },
  {
    assertState: async (page) => {
      const cover = page.locator("#inbjudan");

      await expect(cover.getByText("Ditt svar", { exact: true })).toBeVisible();
      await expect(cover.getByText("Kanske · jag återkommer", { exact: true }))
        .toBeVisible();
      await expect(cover.getByText("Mottaget", { exact: true })).toBeVisible();
      await expect(cover.getByRole("link", { name: /^Uppdatera svar/ }))
        .toHaveAttribute("href", "#osa");
    },
    fixtureKey: "rsvpMaybe",
    heading: "Fredrik & Matilda",
    name: "rsvp-maybe-saved-cover",
    panelLabel: "Inbjudan",
    primaryHash: "inbjudan",
    title: "saved RSVP Kanske cover",
  },
  {
    assertState: async (page) => {
      await expect(page.getByRole("heading", { name: "Uppdatera svar" }))
        .toBeVisible();
      await expect(page.getByRole("radio", { name: /^Nej\s+kan inte$/ }))
        .toBeChecked();
      await expect(page.getByRole("button", { name: "Spara ändringar" }))
        .toBeVisible();
    },
    fixtureKey: "rsvpNo",
    heading: "Uppdatera svar",
    name: "rsvp-no-saved-osa",
    panelLabel: "OSA",
    title: "saved RSVP Nej",
  },
  {
    assertState: async (page) => {
      await expect(page.getByRole("heading", { name: "Uppdatera svar" }))
        .toBeVisible();
      await expect(page.getByRole("radio", { name: /^Kanske\s+återkommer$/ }))
        .toBeChecked();
      await expect(page.getByRole("button", { name: "Spara ändringar" }))
        .toBeVisible();
    },
    fixtureKey: "rsvpMaybe",
    heading: "Uppdatera svar",
    name: "rsvp-maybe-saved-osa",
    panelLabel: "OSA",
    title: "saved RSVP Kanske",
  },
  {
    assertState: async (page, fixture) => {
      await expect(page.getByRole("radio", { name: /^Ja\s+\+1 gäst$/ }))
        .toBeChecked();
      await expect(page.getByRole("textbox", { name: "Namn" }))
        .toHaveValue(fixture.rsvp?.plusOneName ?? "");
      await expect(page.getByRole("textbox", { name: "Telefon" }).nth(1))
        .toHaveValue(fixture.rsvp?.plusOnePhone ?? "");
    },
    fixtureKey: "plusOneExpanded",
    heading: "Uppdatera svar",
    name: "plus-one-expanded-osa",
    panelLabel: "OSA",
    title: "+1 expanded RSVP",
  },
  {
    assertState: async (page) => {
      await expect(page.getByRole("button", { name: "Skickar…" })).toBeDisabled();
      await assertRsvpVisualValues(page, transientRsvpValues.submitting);
    },
    fixtureKey: "rsvpMaybe",
    heading: "Uppdatera svar",
    name: "rsvp-submitting-osa",
    panelLabel: "OSA",
    prepareState: async (page) => {
      const delayedSubmit = await delayNextInvitePost(page);

      await fillRsvpVisualValues(page, transientRsvpValues.submitting);
      await page.getByRole("button", { name: /^Spara ändringar/ }).click();
      await delayedSubmit.submitStarted;

      return async () => {
        delayedSubmit.release();
        await expect(page.getByRole("heading", { name: /^Tack Visual/ })).toBeVisible();
      };
    },
    title: "RSVP submitting",
  },
  {
    assertState: async (page) => {
      await expect(page.getByText("Kunde inte spara")).toBeVisible();
      await expect(
        page.getByText(
          "Inbjudningslänken kunde inte verifieras. Be om en ny länk och försök igen.",
        ),
      ).toBeVisible();
      await assertRsvpVisualValues(page, transientRsvpValues.saveError);
    },
    fixtureKey: "rsvpMaybe",
    heading: "Uppdatera svar",
    name: "rsvp-save-error-osa",
    panelLabel: "OSA",
    prepareState: async (page, fixture) => {
      await failNextInvitePostWithInvalidatedToken(page, fixture);
      await fillRsvpVisualValues(page, transientRsvpValues.saveError);
      await page.getByRole("button", { name: /^Spara ändringar/ }).click();
    },
    title: "RSVP save error",
  },
  {
    assertState: async (page) => {
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

  test.beforeEach(async () => {
    await seedInviteVisualFixtures();
  });

  test("captures invalid link visual artifact", async ({ page }, testInfo) => {
    await page.goto("/invite/not-a-real-token");
    await waitForStableInviteVisuals(page);

    await expect(page.getByRole("heading", { name: "Inbjudan saknas" }))
      .toBeVisible();
    await expect(page.getByText("Den här länken", { exact: true })).toBeVisible();
    await expect(page.getByText("fungerade inte.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "osa@example.com" }))
      .toHaveAttribute("href", "mailto:osa@example.com");
    await expect(page.getByTestId("invite-panel-carousel")).toHaveCount(0);

    await captureNamedInviteVisualScreenshot(page, testInfo, "invalid-link");
  });

  for (const state of visualStates) {
    test(`captures ${state.title} visual artifact`, async ({ page }, testInfo) => {
      const fixture = getInviteVisualFixture(state.fixtureKey);

      let cleanup: InviteVisualStateCleanup | void;

      try {
        await page.goto(`${fixture.path}#${state.primaryHash ?? fixture.primaryHash}`);
        await waitForStableInviteVisuals(page);
        await expect(page).toHaveTitle(/Inbjudan/);
        await assertActivePanelNavigation(page, fixture, state);
        cleanup = await state.prepareState?.(page, fixture);
        await state.assertState(page, fixture);
        await captureInviteVisualScreenshot(page, testInfo, state);
      } finally {
        await cleanup?.();
      }
    });
  }
});
