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

async function dispatchPointer(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y = 420,
  pointerType: "mouse" | "touch" = "touch",
) {
  const shell = page.getByTestId("invite-panel-carousel");
  await shell.dispatchEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    isPrimary: true,
    pointerId: 1,
    pointerType,
  });
}

async function dispatchTouchPointer(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y = 420,
) {
  await dispatchPointer(page, type, x, y, "touch");
}

async function swipePanel(page: Page, fromX: number, toX: number) {
  await dispatchTouchPointer(page, "pointerdown", fromX);
  await dispatchTouchPointer(page, "pointerup", toX);
}

async function flickPanel(page: Page, fromX: number, toX: number, y = 420) {
  const shell = page.getByTestId("invite-panel-carousel");

  await shell.evaluate((element, eventInit) => {
    const base = {
      bubbles: true,
      clientY: eventInit.y,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    } as const;

    element.dispatchEvent(new PointerEvent("pointerdown", {
      ...base,
      clientX: eventInit.fromX,
    }));
    element.dispatchEvent(new PointerEvent("pointerup", {
      ...base,
      clientX: eventInit.toX,
    }));
  }, { fromX, toX, y });
}

async function dragPanelTo(page: Page, fromX: number, toX: number, y = 420) {
  await dispatchTouchPointer(page, "pointerdown", fromX, y);
  await dispatchTouchPointer(page, "pointermove", toX, y);
}

async function releasePanelDrag(page: Page, x: number, y = 420) {
  await dispatchTouchPointer(page, "pointerup", x, y);
}

async function panelFrameTranslateX(page: Page, panelId: (typeof panelIds)[number]) {
  return page.locator(`#${panelId}`).evaluate((panel) => {
    const frame = panel.parentElement;
    const transform = frame ? getComputedStyle(frame).transform : "none";

    if (transform === "none") {
      return 0;
    }

    return new DOMMatrixReadOnly(transform).m41;
  });
}

async function touchActionChainAt(page: Page, x: number, y: number) {
  return page.evaluate(({ x: startX, y: startY }) => {
    const root = document.querySelector('[data-testid="invite-panel-carousel"]');
    const target = document.elementFromPoint(startX, startY);

    if (!(root instanceof Element)) {
      throw new Error("Invite panel carousel is missing.");
    }

    if (!(target instanceof Element) || !root.contains(target)) {
      throw new Error(`Expected (${startX}, ${startY}) to hit the invite panel carousel.`);
    }

    const touchActions: string[] = [];

    for (
      let element: Element | null = target;
      element && root.contains(element);
      element = element.parentElement
    ) {
      touchActions.push(getComputedStyle(element).touchAction);
    }

    return touchActions;
  }, { x, y });
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

  test("centers wider desktop carousel keeps cover art narrow and navigation in sync", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 1000 });
    await page.goto(fixture.path);

    const shell = page.getByTestId("invite-panel-carousel");
    await expect(shell).toBeVisible();
    await expect
      .poll(async () => Math.round((await shell.boundingBox())?.width ?? 0))
      .toBe(704);
    const coverArt = page.locator("#inbjudan section[aria-label='Inbjudan']");
    await expect
      .poll(async () => Math.round((await coverArt.boundingBox())?.width ?? 0))
      .toBeLessThanOrEqual(390);
    await expect
      .poll(async () => Math.round((await coverArt.boundingBox())?.width ?? 0))
      .toBeGreaterThanOrEqual(388);
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

  test("reveals the adjacent panel while dragging and commits after a meaningful drag", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await dragPanelTo(page, 330, 160);

    await expect(page.locator("#inbjudan"), "current panel should follow the finger")
      .toBeVisible();
    await expect(page.locator("#detaljer"), "neighboring panel should be revealed")
      .toBeVisible();
    await expect
      .poll(async () => Math.round(await panelFrameTranslateX(page, "inbjudan")))
      .toBeLessThanOrEqual(-120);
    expect(page.url()).not.toMatch(/#detaljer$/);

    await releasePanelDrag(page, 150);

    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
  });

  test("leaves browser-edge zones eligible for native horizontal gestures", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    for (const touchActions of [
      await touchActionChainAt(page, 24, 420),
      await touchActionChainAt(page, 370, 420),
    ]) {
      expect(touchActions).not.toContain("pan-y");
    }

    expect(await touchActionChainAt(page, 195, 420)).toContain("pan-y");
  });

  test("ignores left browser-edge touch starts without rubber-band motion", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await dragPanelTo(page, 24, 320);

    expect(Math.round(await panelFrameTranslateX(page, "inbjudan"))).toBe(0);
    await expect(page.locator("#detaljer"), "edge-start swipe should not reveal a panel")
      .toBeHidden();

    await releasePanelDrag(page, 320);

    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#detaljer$/);
  });

  test("ignores right browser-edge touch starts without panel motion", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await dragPanelTo(page, 370, 80);

    expect(Math.round(await panelFrameTranslateX(page, "inbjudan"))).toBe(0);
    await expect(page.locator("#detaljer"), "edge-start swipe should not reveal a panel")
      .toBeHidden();

    await releasePanelDrag(page, 80);

    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#detaljer$/);
  });

  test("keeps interior-start swipe ownership after moving into an edge zone", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await swipePanel(page, 320, 24);

    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
  });

  test("commits after a fast horizontal flick below the distance threshold", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await flickPanel(page, 320, 255);

    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
  });

  test("snaps back after a short accidental drag without changing the hash", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await dragPanelTo(page, 320, 280);
    await page.waitForTimeout(180);
    await releasePanelDrag(page, 280);

    await expect(page).not.toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "inbjudan");
  });

  test("ignores vertical intent, interactive starts, and mouse drags", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await dispatchTouchPointer(page, "pointerdown", 250, 700);
    await dispatchTouchPointer(page, "pointermove", 240, 520);
    await dispatchTouchPointer(page, "pointerup", 235, 480);
    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#detaljer$/);

    await dispatchPointer(page, "pointerdown", 320, 420, "mouse");
    await dispatchPointer(page, "pointermove", 120, 420, "mouse");
    await dispatchPointer(page, "pointerup", 120, 420, "mouse");
    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#detaljer$/);

    await page.goto(`${fixture.path}#osa`);
    await expectActivePanel(page, "osa");
    const phoneInput = page.getByRole("textbox", { name: "Telefon" }).first();
    await phoneInput.dispatchEvent("pointerdown", {
      bubbles: true,
      clientX: 320,
      clientY: 520,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    await dispatchTouchPointer(page, "pointermove", 120, 520);
    await dispatchTouchPointer(page, "pointerup", 120, 520);

    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
  });

  test("rubber-bands blocked edge drags without wrapping", async ({ page }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await dragPanelTo(page, 80, 320);
    await expect
      .poll(async () => Math.round(await panelFrameTranslateX(page, "inbjudan")))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Math.round(await panelFrameTranslateX(page, "inbjudan")))
      .toBeLessThan(80);
    await releasePanelDrag(page, 320);
    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#osa$/);

    await page.goto(`${fixture.path}#osa`);
    await expectActivePanel(page, "osa");
    await dragPanelTo(page, 320, 80);
    await expect
      .poll(async () => Math.round(await panelFrameTranslateX(page, "osa")))
      .toBeLessThan(0);
    await expect
      .poll(async () => Math.round(await panelFrameTranslateX(page, "osa")))
      .toBeGreaterThan(-80);
    await releasePanelDrag(page, 80);

    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
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

  test("animates cover CTAs before and after RSVP", async ({ page }) => {
    const beforeRsvpFixture = getInviteVisualFixture("updatesPublished");
    const afterRsvpFixture = getInviteVisualFixture("rsvpNo");

    await page.goto(beforeRsvpFixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("link", { name: /^Öppna inbjudan/ }).click();

    expect(page.url()).not.toMatch(/#detaljer$/);
    await expectMovingPanels(page, "inbjudan", "detaljer");
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");

    await page.goto(afterRsvpFixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("link", { name: /^Uppdatera svar/ }).click();

    expect(page.url()).not.toMatch(/#osa$/);
    await expectMovingPanels(page, "inbjudan", "osa");
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");
  });

  test("animates details panel primary and secondary panel links", async ({ page }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.detailsPath);
    await expectActivePanel(page, "detaljer");

    await page.getByRole("link", { name: /^Vidare till OSA/ }).click();

    expect(page.url()).not.toMatch(/#osa$/);
    await expectMovingPanels(page, "detaljer", "osa");
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");

    await page.goto(fixture.detailsPath);
    await expectActivePanel(page, "detaljer");

    await page
      .locator("#detaljer")
      .getByRole("link", { name: "Till inbjudan" })
      .click();

    expect(page.url()).not.toMatch(/#inbjudan$/);
    await expectMovingPanels(page, "detaljer", "inbjudan");
    await expect(page).toHaveURL(/#inbjudan$/);
    await expectActivePanel(page, "inbjudan");
  });

  test("intercepts same-route panel links that include the path", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(`${fixture.path}?utm=keep#detaljer`);
    await expectActivePanel(page, "detaljer");
    await page.getByRole("link", { name: /^Vidare till OSA/ }).evaluate(
      (link) => {
        link.setAttribute("href", `${window.location.pathname}#osa`);
      },
    );

    await page.getByRole("link", { name: /^Vidare till OSA/ }).click();

    expect(page.url()).not.toMatch(/#osa$/);
    await expectMovingPanels(page, "detaljer", "osa");
    await expect(page).toHaveURL(/\?utm=keep#osa$/);
    await expectActivePanel(page, "osa");

    await page.goto(`${fixture.path}?utm_b=2&utm_a=1#detaljer`);
    await expectActivePanel(page, "detaljer");
    await page.getByRole("link", { name: /^Vidare till OSA/ }).evaluate(
      (link) => {
        link.setAttribute(
          "href",
          `${window.location.pathname}?utm_a=1&utm_b=2#osa`,
        );
      },
    );

    await page.getByRole("link", { name: /^Vidare till OSA/ }).click();

    expect(page.url()).not.toMatch(/#osa$/);
    await expectMovingPanels(page, "detaljer", "osa");
    await expect(page).toHaveURL(/\?utm_b=2&utm_a=1#osa$/);
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

  test("syncs browser-owned edge history traversal without replaying panel motion", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("button", { name: "Nästa panel" }).click();
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");

    await page.getByRole("button", { name: "Nästa panel" }).click();
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");

    await dispatchTouchPointer(page, "pointerdown", 24);
    await page.goBack();

    await expect(page).toHaveURL(/#detaljer$/);
    await expect(page.locator("#osa"), "native edge traversal should not replay panel motion")
      .toBeHidden({ timeout: 100 });
    await expectActivePanel(page, "detaljer");
  });

  test("animates browser back and forward through committed panel hashes", async ({
    page,
  }) => {
    const fixture = getInviteVisualFixture("updatesPublished");

    await page.goto(fixture.path);
    await expectActivePanel(page, "inbjudan");

    await page.getByRole("button", { name: "Nästa panel" }).click();
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");

    await page.getByRole("button", { name: "Nästa panel" }).click();
    await expect(page).toHaveURL(/#osa$/);
    await expectActivePanel(page, "osa");

    await page.goBack();
    expect(page.url()).toMatch(/#detaljer$/);
    await expect(page.getByRole("link", { name: "Gå till OSA" }))
      .toHaveAttribute("aria-current", "step");
    await expectMovingPanels(page, "osa", "detaljer");
    await expect(page).toHaveURL(/#detaljer$/);
    await expectActivePanel(page, "detaljer");

    await page.goForward();
    expect(page.url()).toMatch(/#osa$/);
    await expect(page.getByRole("link", { name: "Gå till Detaljer" }))
      .toHaveAttribute("aria-current", "step");
    await expectMovingPanels(page, "detaljer", "osa");
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

    await page.goto(`${fixture.path}#inbjudan`);
    await expectActivePanel(page, "inbjudan");
    await dragPanelTo(page, 320, 280);
    await page.waitForTimeout(180);
    await releasePanelDrag(page, 280);
    await expectActivePanel(page, "inbjudan");
    await expect(page).not.toHaveURL(/#detaljer$/);

    await dragPanelTo(page, 330, 150);
    await releasePanelDrag(page, 140);

    expect(page.url()).toMatch(/#detaljer$/);
    await expectActivePanel(page, "detaljer");
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
