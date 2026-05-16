import { expect, test, type Page } from "@playwright/test";

import {
  getInviteVisualFixture,
  seedInviteVisualFixtures,
} from "./support/invite-visual-fixtures";

const panelIds = ["inbjudan", "detaljer", "osa"] as const;
const panelLabels = {
  detaljer: "Detaljer",
  inbjudan: "Inbjudan",
  osa: "OSA",
} as const satisfies Record<(typeof panelIds)[number], string>;

async function expectActivePanel(page: Page, activePanelId: (typeof panelIds)[number]) {
  for (const panelId of panelIds) {
    const panel = page.locator(`#${panelId}`);

    if (panelId === activePanelId) {
      await expect(panel, `${panelId} should be the only visible panel`).toBeVisible();
      await expect(
        page.getByRole("link", { name: `Gå till ${panelLabels[panelId]}` }),
      ).toHaveAttribute("aria-current", "step");
    } else {
      await expect(panel, `${panelId} should be hidden when ${activePanelId} is active`)
        .toBeHidden();
    }
  }
}

async function swipePanel(page: Page, fromX: number, toX: number) {
  const shell = page.getByTestId("invite-panel-carousel");
  const eventBase = { bubbles: true, clientY: 420, pointerId: 1, pointerType: "touch" };

  await shell.dispatchEvent("pointerdown", { ...eventBase, clientX: fromX });
  await shell.dispatchEvent("pointerup", { ...eventBase, clientX: toX });
}

async function expectMovingPanels(
  page: Page,
  fromPanelId: (typeof panelIds)[number],
  toPanelId: (typeof panelIds)[number],
) {
  await expect(page.locator(`#${fromPanelId}`), `${fromPanelId} should remain visible while moving`)
    .toBeVisible();
  await expect(page.locator(`#${toPanelId}`), `${toPanelId} should enter while moving`)
    .toBeVisible();

  for (const panelId of panelIds) {
    if (panelId !== fromPanelId && panelId !== toPanelId) {
      await expect(page.locator(`#${panelId}`), `${panelId} should not peek during direct motion`)
        .toBeHidden();
    }
  }
}

test.describe.serial("invite one-panel shell", () => {
  test.beforeEach(async () => {
    await seedInviteVisualFixtures();
  });

  test("centers a 390px postcard and keeps dot, arrow, and hash navigation in sync", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 1000 });
    await page.goto(fixture.path);

    const shell = page.getByTestId("invite-panel-carousel");
    await expect(shell).toBeVisible();
    await expect
      .poll(async () => Math.round((await shell.boundingBox())?.width ?? 0))
      .toBe(390);
    await expectActivePanel(page, "inbjudan");
    await expect(page.getByRole("button", { name: "Föregående panel" }))
      .toBeDisabled();
    await expect(page.getByRole("button", { name: "Nästa panel" })).toBeEnabled();

    await page.getByRole("link", { name: "Gå till Detaljer" }).click();
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
    await expect(page.getByRole("button", { name: "Föregående panel" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Nästa panel" })).toBeEnabled();

    await page.getByRole("button", { name: "Nästa panel" }).click();
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
    await expect(page.getByRole("button", { name: "Föregående panel" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Nästa panel" })).toBeDisabled();
  });

  test("animates arrow navigation and commits the hash after the panel settles", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("button", { name: "Nästa panel" }).click();

    expect(page.url()).not.toMatch(/#detaljer$/);
    await expectMovingPanels(page, "inbjudan", "detaljer");

    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
  });

  test("animates direct dot jumps without stopping on skipped panels", async ({ page }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("link", { name: "Gå till OSA" }).click();

    expect(page.url()).not.toMatch(/#osa$/);
    await expectMovingPanels(page, "inbjudan", "osa");

    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
  });

  test("uses the latest requested arrow target instead of queueing stale motion", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("button", { name: "Nästa panel" }).click();
    await page.getByRole("button", { name: "Nästa panel" }).click();

    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
  });

  test("uses the latest requested dot target instead of stopping on stale motion", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("link", { name: "Gå till Detaljer" }).click();
    await page.getByRole("link", { name: "Gå till OSA" }).click();

    expect(page.url()).not.toMatch(/#detaljer$/);
    await expectMovingPanels(page, "inbjudan", "osa");
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
  });

  test("switches panels instantly when reduced motion is requested", async ({ page }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("link", { name: "Gå till OSA" }).click();

    expect(page.url()).toMatch(/#osa$/);
    await expectActivePanel(page, "osa");
  });

  test("opens matching panels from invite hash deep links", async ({ page }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    for (const panelId of panelIds) {
      await page.goto(`${fixture.path}#${panelId}`);
      await expectActivePanel(page, panelId);
      await expect(page).toHaveURL(new RegExp(`#${panelId}$`));
    }
  });

  test("changes panels with touch swipes without wrapping", async ({ page }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await swipePanel(page, 80, 320);
    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#detaljer$/);

    await swipePanel(page, 320, 80);
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");

    await swipePanel(page, 320, 80);
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");

    await swipePanel(page, 320, 80);
    await expectActivePanel(page, "osa");
    await expect(page).toHaveURL(/#osa$/);

    await swipePanel(page, 80, 320);
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
  });
});
