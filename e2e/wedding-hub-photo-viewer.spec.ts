import { expect, type Locator, type Page } from "@playwright/test";
import { PHOTO_UPLOAD_BUCKET } from "../lib/photo-upload";
import type { HubPhotoData } from "../lib/wedding-hub-photo-verification";
import { testWithWeddingSettings as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import { updateWeddingSettings } from "./support/wedding-settings";

const PREFIX = "e2e-hub-viewer-";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
const file = (name: string) => ({ name: `${PREFIX}${name}.png`, mimeType: "image/png", buffer: PNG });
const modal = (page: Page) => page.getByRole("dialog", { name: "Våra bilder" });
const photoButton = (page: Page, id: string) => page.locator(`button[data-photo-id="${id}"]`);
const count = (page: Page, position: number, total = 3) => expect(modal(page).getByText(`Bild ${position} av ${total}`, { exact: true })).toBeVisible();

async function expectModalFocusAfterPaint(page: Page) {
  // Native disabled-control blur is deferred. Model separate physical key presses
  // rather than letting an immediate opposite arrow mask lost focus.
  await page.waitForTimeout(200);
  expect(await modal(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
}

async function uploadedRows() {
  const result = await createE2eSupabaseAdminClient().from("photo_uploads")
    .select("id, original_filename, storage_path, thumbnail_storage_path, note, verification_status, moderation_status, mime_type, size_bytes")
    .eq("wedding_id", SEEDED_WEDDING_ID).like("original_filename", `${PREFIX}%`);
  expect(result.error).toBeNull();
  return result.data ?? [];
}

async function choose(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ladda upp bilder", exact: true }).click();
  await (await chooser).setFiles(file(name));
}

// Real sign/Storage/finalize for the seed; only the loaded browse collection is
// mocked so one/zero/reordered collections never require deleting others' photos.
async function browseCollection(page: Page, length = 3) {
  let collection: HubPhotoData;
  await page.route("**/api/wedding-hub/photos", async route => {
    if (!collection) {
      const real: HubPhotoData = await (await route.fetch()).json();
      const seed = real.photos.photos.find(photo => photo.note === `${PREFIX}seed`);
      expect(seed).toBeTruthy();
      const photos = Array.from({ length }, (_, index) => ({
        ...seed!, id: `viewer-${index}`, photoUrl: `${seed!.photoUrl}&viewer=${index}`, who: ["Maja", "Erik", "Linnea"][index % 3],
        note: index === 0 ? "Vilken härlig kväll!" : index === 1 ? "Tack för dansen. ".repeat(32) : null,
      }));
      collection = { photos: { totalPhotoCount: 99, photos }, feed: photos.map(photo => ({ ...photo, when: "Nyss", caption: photo.note })) };
    }
    await route.fulfill({ json: collection });
  });
  await page.goto("/wedding-hub");
  await choose(page, "seed");
  await page.getByPlaceholder("Lägg till kommentar").fill(`${PREFIX}seed`);
  await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
  await expect(photoButton(page, "viewer-0")).toBeVisible();
  return {
    replacePhotos: (photos: HubPhotoData["photos"]["photos"]) => {
      collection = { photos: { totalPhotoCount: photos.length, photos }, feed: photos.map(photo => ({ ...photo, when: "Nyss", caption: photo.note })) };
    },
    photos: () => collection.photos.photos,
  };
}

async function gesture(target: Locator, points: Array<[number, number]>, pinch = false) {
  await target.evaluate((element, { points, pinch }) => {
    const touch = (point: [number, number], identifier = 1) => new Touch({ identifier, target: element, clientX: point[0], clientY: point[1] });
    const send = (type: string, point: [number, number], extra = false) => {
      element.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [touch(point), ...(extra ? [touch([point[0] + 40, point[1]], 2)] : [])], changedTouches: [touch(point)] }));
    };
    send("touchstart", points[0]);
    for (const point of points.slice(1, -1)) send("touchmove", point, pinch);
    send("touchend", points[points.length - 1]);
  }, { points, pinch });
}

test.describe("Wedding hub photo viewer", () => {
  test.use({ hasTouch: true });
  const paths = new Set<string>();
  test.beforeEach(async ({ page }) => {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    expect(url.protocol).toBe("http:");
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
    expect(url.port).toBe("54321");
    expect(SEEDED_WEDDING_ID).toBe("00000000-0000-0000-0000-000000000001");
    paths.clear();
    await page.route("**/api/wedding-hub/photos/sign", async route => {
      const response = await route.fetch();
      for (const intent of (await response.json()).uploadIntents ?? []) {
        paths.add(intent.uploadPath);
        if (intent.thumbnailPath) paths.add(intent.thumbnailPath);
      }
      await route.fulfill({ response });
    });
    await page.route("**/api/wedding-hub/photos/finalize", async route => { await route.fulfill({ response: await route.fetch() }); });
  });
  test.afterEach(async ({ page }) => {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    const rows = await uploadedRows();
    for (const row of rows) {
      paths.add(row.storage_path);
      if (row.thumbnail_storage_path) paths.add(row.thumbnail_storage_path);
    }
    const db = createE2eSupabaseAdminClient();
    if (paths.size) expect((await db.storage.from(PHOTO_UPLOAD_BUCKET).remove([...paths])).error).toBeNull();
    if (rows.length) expect((await db.from("photo_uploads").delete().in("id", rows.map(row => row.id))).error).toBeNull();
  });

  for (const tab of ["Flöde", "Galleriet"]) {
    test(`${tab} opens same-page viewer with boundaries, captions, keyboard and focus return`, async ({ page }) => {
      await browseCollection(page);
      await page.getByRole("button", { name: tab, exact: true }).click();
      const opener = photoButton(page, "viewer-0");
      await opener.scrollIntoViewIfNeeded();
      const scrollY = await page.evaluate(() => window.scrollY);
      await opener.click();
      await expect(modal(page)).toBeVisible();
      await expect(modal(page).getByRole("button", { name: "Stäng" })).toBeFocused();
      await expect(modal(page)).toContainText("Vilken härlig kväll!");
      await count(page, 1);
      await expect(modal(page).getByRole("button", { name: "Föregående bild" })).toBeDisabled();
      await page.keyboard.press("ArrowLeft");
      await count(page, 1);
      await page.keyboard.press("ArrowRight");
      await count(page, 2);
      await expect(modal(page).getByLabel("Bildtext")).toContainText("Tack för dansen.");
      await modal(page).getByRole("button", { name: "Nästa bild" }).click();
      await count(page, 3);
      await expect(modal(page).getByRole("button", { name: "Nästa bild" })).toBeDisabled();
      await page.keyboard.press("ArrowRight");
      await count(page, 3);
      await expect(modal(page).getByLabel("Bildtext")).toHaveText("Linnea");
      await modal(page).getByRole("button", { name: "Föregående bild" }).click();
      await count(page, 2);
      await expect(modal(page).getByRole("img")).toHaveCSS("object-fit", "contain");
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press("Tab");
        expect(await modal(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
      }
      await modal(page).getByRole("button", { name: "Stäng" }).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(modal(page).getByRole("link", { name: /Öppna original/ })).toBeFocused();
      expect(page.context().pages()).toHaveLength(1);
      await expect(page).toHaveURL(/\/wedding-hub$/);
      expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");
      await page.keyboard.press("Escape");
      await expect(modal(page)).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
      expect(await page.evaluate(() => document.body.style.position)).toBe("");
    });
  }

  test("caption focus survives repeated arrows and scroll resets without remounting", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await browseCollection(page);
    const opener = photoButton(page, "viewer-0");
    await opener.click();
    await page.keyboard.press("Tab");
    const caption = modal(page).getByLabel("Bildtext");
    await expect(caption).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expectModalFocusAfterPaint(page);
    await count(page, 2);
    await expect(caption).toBeFocused();
    await caption.evaluate(el => { el.scrollTop = 60; });
    expect(await caption.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    for (const [key, position] of [["ArrowRight", 3], ["ArrowRight", 3], ["ArrowLeft", 2], ["ArrowLeft", 1]] as const) {
      await page.keyboard.press(key);
      await expectModalFocusAfterPaint(page);
      await count(page, position);
      await expect(caption).toBeFocused();
      expect(await caption.evaluate(el => el.scrollTop)).toBe(0);
    }
    await page.getByRole("button", { name: "Stäng" }).click();
    await expect(opener).toBeFocused();
  });

  for (const next of [true, false]) {
    test(`focused ${next ? "Next" : "Previous"} survives boundary activation and opposite arrow`, async ({ page }) => {
      await browseCollection(page);
      const opener = photoButton(page, "viewer-1");
      await opener.click();
      const button = modal(page).getByRole("button", { name: next ? "Nästa bild" : "Föregående bild" });
      await button.focus();
      await page.keyboard.press("Enter");
      await expectModalFocusAfterPaint(page);
      await count(page, next ? 3 : 1);
      await expect(button).toBeFocused();
      await expect(button).toBeDisabled();
      // aria-disabled remains keyboard-focusable; guarded activation must no-op.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await expectModalFocusAfterPaint(page);
      await count(page, next ? 3 : 1);
      await page.keyboard.press(next ? "ArrowLeft" : "ArrowRight");
      await expectModalFocusAfterPaint(page);
      await count(page, 2);
      await expect(button).toBeFocused();
      await expect(button).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
    });
  }

  test("one photo has honest loaded count and no navigation", async ({ page }) => {
    await browseCollection(page, 1);
    await photoButton(page, "viewer-0").click();
    await count(page, 1, 1); // API total is 99; viewer describes only loaded photos.
    await expect(modal(page).getByRole("button", { name: "Föregående bild" })).toBeDisabled();
    await expect(modal(page).getByRole("button", { name: "Nästa bild" })).toBeDisabled();
    await page.keyboard.press("ArrowRight");
    await count(page, 1, 1);
    await modal(page).getByRole("button", { name: "Stäng" }).click();
    await expect(photoButton(page, "viewer-0")).toBeFocused();
  });

  for (const empty of [false, true]) {
    test(`background refresh ${empty ? "removes selected photo without swapping" : "keeps selected id after insertion"}; busy viewer cannot upload`, async ({ page }) => {
      const collection = await browseCollection(page);
      await choose(page, "background");
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/api/wedding-hub/photos/finalize", async route => {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      }, { times: 1 });
      await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
      await photoButton(page, "viewer-1").click();
      try {
        await expect(modal(page).getByRole("button", { name: /Ladda upp egna bilder/ })).toBeDisabled();
        await page.keyboard.press("Tab");
        await expect(modal(page).getByLabel("Bildtext")).toBeFocused();
        const photos = collection.photos();
        collection.replacePhotos(empty ? [] : [{ ...photos[0], id: "new-first", who: "Ny gäst" }, ...photos]);
      } finally { release(); }
      if (empty) {
        await expect(modal(page).getByRole("status")).toContainText("Bilden är inte längre tillgänglig");
        await expect(modal(page).getByRole("img")).toHaveCount(0);
        await expect(modal(page).getByRole("link")).toHaveCount(0);
        await expectModalFocusAfterPaint(page);
        await expect(modal(page).getByRole("button", { name: "Stäng" })).toBeFocused();
      } else {
        await count(page, 3, 4);
        await expect(modal(page).getByLabel("Bildtext")).toContainText("Erik");
      }
      await expect(modal(page).getByRole("button", { name: /Ladda upp egna bilder/ })).toBeEnabled();
      await page.keyboard.press("Escape");
      if (empty) await expect(page.getByRole("region", { name: "Bildvyer" })).toBeFocused();
      await expect(page.getByRole("button", { name: "Ladda upp bilder", exact: true })).toBeEnabled();
    });
  }

  test("mobile swipe ignores taps, vertical turns and pinch; caption scroll and controls remain usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await browseCollection(page);
    await photoButton(page, "viewer-0").click();
    const stage = modal(page).getByRole("img").locator("..");
    await gesture(stage, [[300, 250], [200, 250], [80, 255]]);
    await count(page, 2);
    await stage.tap();
    await gesture(stage, [[160, 250], [162, 252]]);
    await count(page, 2);
    await gesture(stage, [[160, 250], [162, 300], [30, 310]]);
    await count(page, 2);
    await gesture(stage, [[300, 250], [200, 250], [80, 250]], true);
    await count(page, 2);
    const caption = modal(page).getByLabel("Bildtext");
    expect(await caption.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await caption.evaluate(el => { el.scrollTop = 60; });
    expect(await caption.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await gesture(stage, [[60, 250], [150, 250], [300, 250]]);
    await count(page, 1);
    await modal(page).getByRole("button", { name: "Nästa bild" }).tap();
    await count(page, 2);
    expect(await modal(page).getByLabel("Bildtext").evaluate(el => el.scrollTop)).toBe(0);
    const upload = modal(page).getByRole("button", { name: /Ladda upp egna bilder/ });
    const box = await upload.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test("sticky picker remains reachable below gallery without covering last photo", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Keep enough rows to scroll the primary actions out of the compact hub.
    await browseCollection(page, 18);
    await page.getByRole("button", { name: "Galleriet", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByRole("button", { name: "Ladda upp bilder", exact: true })).not.toBeInViewport();
    const sticky = page.getByRole("button", { name: "↑ Välj bilder", exact: true });
    await expect(sticky).toBeInViewport();
    const last = await photoButton(page, "viewer-17").boundingBox();
    const bar = await sticky.locator("../..").boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y);
    await photoButton(page, "viewer-17").tap();
    await expect(sticky).toHaveCount(0);
    await expect(modal(page).getByRole("button", { name: /Ladda upp egna bilder/ })).toBeInViewport();
  });

  for (const fails of [false, true]) {
    test(`held original keeps next/upload responsive, loading clears on ${fails ? "error" : "load"}`, async ({ page }) => {
      await browseCollection(page);
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/storage/v1/object/sign/**", async route => {
        if (new URL(route.request().url()).searchParams.get("viewer") !== "0") return route.fallback();
        const response = await route.fetch();
        await gate;
        if (fails) await route.abort("failed");
        else await route.fulfill({ response });
      });
      try {
        await photoButton(page, "viewer-0").click();
        await expect(modal(page).getByRole("status")).toHaveText("Laddar bild…");
        await modal(page).getByRole("button", { name: "Nästa bild" }).click();
        await count(page, 2);
        await expect(modal(page).getByRole("status")).toHaveCount(0);
        await modal(page).getByRole("button", { name: "Föregående bild" }).click();
        await expect(modal(page).getByRole("status")).toHaveText("Laddar bild…");
        const chooser = page.waitForEvent("filechooser");
        await modal(page).getByRole("button", { name: /Ladda upp egna bilder/ }).click();
        await (await chooser).setFiles([]);
        await expect(modal(page)).toHaveCount(0);
        await photoButton(page, "viewer-0").click();
        await expect(modal(page).getByRole("status")).toHaveText("Laddar bild…");
      } finally { release(); }
      await expect(modal(page).getByText("Laddar bild…")).toHaveCount(0);
      if (fails) {
        await expect(modal(page).getByRole("status")).toContainText("Bilden kan inte visas här");
      } else {
        await expect(modal(page).getByRole("status")).toHaveCount(0);
        await expect.poll(() => modal(page).getByRole("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
      }
    });
  }

  test("failed original gives explicit original link, navigation recovers", async ({ page }) => {
    await browseCollection(page);
    await page.route("**/storage/v1/object/sign/**", async route => {
      if (route.request().resourceType() === "image" && new URL(route.request().url()).searchParams.get("viewer") === "0") return route.abort("failed");
      return route.fallback();
    });
    await photoButton(page, "viewer-0").click();
    await expect(modal(page).getByRole("status")).toContainText("Bilden kan inte visas här");
    await expect(modal(page).getByText("Laddar bild…")).toHaveCount(0);
    const original = modal(page).getByRole("link", { name: /Öppna original/ });
    await expect(original).toHaveAttribute("target", "_blank");
    expect(await (await page.request.get(await original.getAttribute("href") ?? "")).body()).toEqual(PNG);
    await modal(page).getByRole("button", { name: "Nästa bild" }).click();
    await count(page, 2);
    await expect(modal(page).getByRole("img")).toBeVisible();
    await expect.poll(() => modal(page).getByRole("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  });

  test("viewer upload opens chooser synchronously, cancel stays usable, selection reveals note queue then real upload succeeds", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await browseCollection(page);
    await photoButton(page, "viewer-0").click();
    let chooser = page.waitForEvent("filechooser");
    await modal(page).getByRole("button", { name: /Ladda upp egna bilder/ }).click();
    await (await chooser).setFiles([]);
    await expect(modal(page)).toHaveCount(0);
    await expect(photoButton(page, "viewer-0")).toBeFocused();
    await photoButton(page, "viewer-0").click();
    chooser = page.waitForEvent("filechooser");
    await modal(page).getByRole("button", { name: /Ladda upp egna bilder/ }).click();
    await (await chooser).setFiles(file("from-viewer"));
    await expect(modal(page)).toHaveCount(0);
    const queue = page.getByRole("region", { name: "Valda filer" });
    await expect(queue).toBeFocused();
    await expect(page.getByPlaceholder("Lägg till kommentar")).toBeInViewport();
    expect(await uploadedRows()).toHaveLength(1); // Selecting never signs/submits.
    await page.getByPlaceholder("Lägg till kommentar").fill("Från bildvisaren med kärlek");
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(queue).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("1 bild uppladdad.");
    const row = (await uploadedRows()).find(row => row.original_filename === `${PREFIX}from-viewer.png`)!;
    expect(row).toMatchObject({ note: "Från bildvisaren med kärlek", verification_status: "verified", moderation_status: "approved", mime_type: "image/png", size_bytes: PNG.length });
    const stored = await createE2eSupabaseAdminClient().storage.from(PHOTO_UPLOAD_BUCKET).download(row.storage_path);
    expect(stored.error).toBeNull();
    expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(PNG);
  });

  test("no-access viewer still browses but every upload entry stays disabled", async ({ page }) => {
    await browseCollection(page);
    const [seed] = await uploadedRows();
    await updateWeddingSettings({ allow_anonymous_hub_upload: false });
    await page.reload();
    await photoButton(page, seed.id).click();
    await expect(modal(page).getByRole("button", { name: /Ladda upp egna bilder/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Ladda upp bilder", exact: true })).toBeDisabled();
    await expect(page.locator('input[type="file"]')).toBeDisabled();
  });
});
