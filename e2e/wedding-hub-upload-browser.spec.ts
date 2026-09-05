import { expect, type Page } from "@playwright/test";
import { PHOTO_UPLOAD_BUCKET } from "../lib/photo-upload";
import { getHubWedding } from "../lib/wedding-hub";
import { finalizePhotoUploads } from "../lib/wedding-hub-photo-verification";
import { testWithWeddingSettings as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import { updateWeddingSettings } from "./support/wedding-settings";

const PREFIX = "e2e-hub-browser-";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");

async function rows() {
  const result = await createE2eSupabaseAdminClient().from("photo_uploads")
    .select("id, original_filename, note, storage_path, thumbnail_storage_path, verification_status, moderation_status, mime_type, size_bytes, guest_id")
    .eq("wedding_id", SEEDED_WEDDING_ID).like("original_filename", `${PREFIX}%`);
  expect(result.error).toBeNull();
  return result.data ?? [];
}

async function pick(page: Page, names: string[]) {
  await page.goto("/wedding-hub");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ladda upp bilder", exact: true }).click();
  await (await chooser).setFiles(names.map(name => ({ name, mimeType: "image/png", buffer: PNG })));
}

test.describe("Wedding hub browser upload", () => {
  const signedPaths = new Set<string>();

  test.beforeEach(async ({ page }) => {
    signedPaths.clear();
    // Let cleanup wait for any in-flight server finalization, including failed tests.
    await page.route("**/api/wedding-hub/photos/finalize", async route => {
      await route.fulfill({ response: await route.fetch() });
    });
    // Track every signed path, including objects never finalized, for test-owned cleanup.
    await page.route("**/api/wedding-hub/photos/sign", async route => {
      const response = await route.fetch();
      const payload = await response.json();
      for (const intent of payload.uploadIntents ?? []) {
        signedPaths.add(intent.uploadPath);
        if (intent.thumbnailPath) signedPaths.add(intent.thumbnailPath);
      }
      await route.fulfill({ response });
    });
  });

  test.afterEach(async ({ page }) => {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    const db = createE2eSupabaseAdminClient();
    const uploaded = await rows();
    for (const row of uploaded) {
      signedPaths.add(row.storage_path);
      if (row.thumbnail_storage_path) signedPaths.add(row.thumbnail_storage_path);
    }
    if (signedPaths.size) {
      expect((await db.storage.from(PHOTO_UPLOAD_BUCKET).remove([...signedPaths])).error).toBeNull();
    }
    if (uploaded.length) {
      expect((await db.from("photo_uploads").delete().in("id", uploaded.map(row => row.id))).error).toBeNull();
    }
  });

  test("later lost finalize response preserves earlier success and retries same claim without another Storage PUT", async ({ page }) => {
    let puts = 0;
    let signs = 0;
    const claims: string[] = [];
    page.on("request", request => {
      if (request.method() === "PUT") puts += 1;
      if (request.url().endsWith("/photos/sign")) signs += 1;
      if (request.url().endsWith("/photos/finalize")) claims.push(request.postDataJSON().uploads[0].originalClaim);
    });
    let dropSecondResponse = true;
    await page.route("**/api/wedding-hub/photos/finalize", async route => {
      const upload = route.request().postDataJSON().uploads[0];
      if (!dropSecondResponse || upload.originalFileName !== `${PREFIX}lost-response.png`) return route.fallback();
      dropSecondResponse = false;
      const response = await route.fetch();
      expect((await response.json()).succeeded).toBe(1);
      // Server committed the later file, but browser never receives that success.
      await route.abort("failed");
    });
    await pick(page, [`${PREFIX}confirmed.png`, `${PREFIX}lost-response.png`]);
    await page.getByPlaceholder("Lägg till kommentar").nth(1).fill("Keep original note");
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByRole("button", { name: /^Ladda upp \d/ })).toBeEnabled();
    await expect(page.getByPlaceholder("Lägg till kommentar")).toBeDisabled();
    const firstPutCount = puts;
    expect(firstPutCount).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(`${PREFIX}confirmed.png`, { exact: true })).toHaveCount(0);
    expect(await rows()).toHaveLength(2);
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
    expect(signs).toBe(2);
    expect(puts).toBe(firstPutCount);
    expect(claims).toHaveLength(3);
    expect(claims[2]).toBe(claims[1]);
    expect(await rows()).toHaveLength(2);
    expect((await rows()).find(row => row.original_filename === `${PREFIX}lost-response.png`)).toMatchObject({ note: "Keep original note", verification_status: "verified" });
  });

  test("confirmed transient header rejection retries with a fresh upload after the original is purged", async ({ page }) => {
    const db = createE2eSupabaseAdminClient();
    const wedding = await getHubWedding({ supabase: db });
    expect(wedding).not.toBeNull();
    let signs = 0;
    let puts = 0;
    let failHeader = true;
    page.on("request", request => {
      if (request.url().endsWith("/photos/sign")) signs += 1;
      if (request.method() === "PUT") puts += 1;
    });
    await page.route("**/api/wedding-hub/photos/finalize", async route => {
      if (!failHeader) return route.fallback();
      failHeader = false;
      // Run the real verifier/purge against local Storage, failing only its header GET.
      const originalFetch = globalThis.fetch;
      let headerFailures = 0;
      globalThis.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes(`/storage/v1/object/sign/${PHOTO_UPLOAD_BUCKET}/`) && init?.method === "GET") {
          headerFailures += 1;
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return originalFetch(input, init);
      };
      try {
        const results = await finalizePhotoUploads({
          supabase: db,
          wedding: wedding!,
          attribution: { guestNavigationSession: null, guestName: null },
          items: route.request().postDataJSON().uploads,
        });
        expect(headerFailures).toBe(1);
        expect(results[0]).toMatchObject({ success: false, status: "rejected", reason: "header_fetch_failed" });
        await route.fulfill({ json: { results } });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
    await pick(page, [`${PREFIX}transient-header.png`]);
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("header_fetch_failed", { exact: true })).toBeVisible();
    const [rejected] = await rows();
    expect(rejected.verification_status).toBe("rejected");
    expect((await db.storage.from(PHOTO_UPLOAD_BUCKET).info(rejected.storage_path)).data).toBeNull();
    const firstPutCount = puts;
    expect(firstPutCount).toBeGreaterThanOrEqual(1);

    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("1 bild uppladdad.");
    expect(signs).toBe(2);
    expect(puts).toBeGreaterThan(firstPutCount);
    const uploaded = await rows();
    expect(uploaded).toHaveLength(2);
    const verified = uploaded.find(row => row.verification_status === "verified");
    expect(verified).toBeDefined();
    expect(verified!.storage_path).not.toBe(rejected.storage_path);
    const original = await db.storage.from(PHOTO_UPLOAD_BUCKET).download(verified!.storage_path);
    expect(original.error).toBeNull();
    expect(Buffer.from(await original.data!.arrayBuffer())).toEqual(PNG);
  });

  test("held gallery refresh cannot block the next photo or keep upload controls locked", async ({ page }) => {
    let galleryRequests = 0;
    let releaseGallery!: () => void;
    const heldGallery = new Promise<void>(resolve => { releaseGallery = resolve; });
    await page.route("**/api/wedding-hub/photos", async route => {
      galleryRequests += 1;
      await heldGallery;
      await route.fulfill({ response: await route.fetch() });
    });
    await pick(page, [`${PREFIX}held-gallery-first.png`, `${PREFIX}held-gallery-second.png`]);
    try {
      await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
      await expect.poll(() => galleryRequests).toBe(1);
      await expect.poll(async () => (await rows()).filter(row => row.verification_status === "verified").length).toBe(2);
      await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveText("2 bilder uppladdade.");
      await expect(page.getByRole("button", { name: "Ladda upp bilder", exact: true })).toBeEnabled();
      // A new selection proves both the visible busy state and the ref lock were released.
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Ladda upp bilder", exact: true }).click();
      await (await chooser).setFiles({ name: `${PREFIX}next-batch.png`, mimeType: "image/png", buffer: PNG });
      await expect(page.getByRole("button", { name: /^Ladda upp \d/ })).toBeEnabled();
      await expect(page.getByPlaceholder("Lägg till kommentar")).toBeEnabled();
      await expect(page.getByRole("button", { name: "Ta bort", exact: true })).toBeEnabled();
      expect(galleryRequests).toBe(1);
    } finally {
      releaseGallery();
    }
  });

  test("gallery refresh failure cannot undo verified success", async ({ page }) => {
    await page.route("**/api/wedding-hub/photos", route => route.abort("failed"));
    await pick(page, [`${PREFIX}gallery-offline.png`]);
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("1 bild uppladdad.");
    expect((await rows())[0]).toMatchObject({ verification_status: "verified" });
  });

  for (const count of [1, 2]) {
    test(`picker upload with review on keeps ${count} photo(s) private and confirms receipt`, async ({ page }) => {
      await updateWeddingSettings({ photo_upload_requires_review: true });
      await pick(page, Array.from({ length: count }, (_, index) => `${PREFIX}review-${index}.png`));
      await page.getByPlaceholder("Lägg till kommentar").nth(0).fill("Private until reviewed");
      await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
      await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveText(count === 1 ? "1 bild skickad för granskning." : "2 bilder skickade för granskning.");
      const uploaded = await rows();
      expect(uploaded).toHaveLength(count);
      expect(uploaded.find(row => row.original_filename === `${PREFIX}review-0.png`)?.note).toBe("Private until reviewed");
      const gallery = await (await page.request.get("/api/wedding-hub/photos")).json();
      await page.getByRole("button", { name: "Galleriet" }).click();
      for (const row of uploaded) {
        expect(row).toMatchObject({ verification_status: "verified", moderation_status: "pending" });
        expect(gallery.photos.photos.some((photo: { id: string }) => photo.id === row.id)).toBe(false);
        await expect(page.locator(`a[href*="${row.storage_path}"]`)).toHaveCount(0);
      }
    });
  }

  test("HEIC header is accepted; unsupported preview offers original in picker and gallery", async ({ page }) => {
    // Signature fixture, not proof of full HEIC decoding or a real iPhone capture.
    const heic = Buffer.from("000000186674797068656963000000006d69663168656963", "hex");
    await page.goto("/wedding-hub");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Ladda upp bilder", exact: true }).click();
    await (await chooser).setFiles({ name: `${PREFIX}phone.heic`, mimeType: "image/heic", buffer: heic });
    const original = page.getByRole("link", { name: `Öppna original: ${PREFIX}phone.heic` });
    await expect(original).toContainText("Öppna original");
    await expect(original).toHaveAttribute("href", /^blob:/);
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
    const [row] = await rows();
    expect(row).toMatchObject({ verification_status: "verified", mime_type: "image/heic", size_bytes: heic.length, thumbnail_storage_path: null });
    await page.getByRole("button", { name: "Galleriet" }).click();
    const galleryOriginal = page.locator(`a[href*="${row.storage_path}"]`);
    await expect(galleryOriginal).toContainText("Öppna original");
    await expect(galleryOriginal).toHaveAttribute("target", "_blank");
    const response = await page.request.get(await galleryOriginal.getAttribute("href") ?? "");
    expect(response.ok()).toBe(true);
    expect(await response.body()).toEqual(heic);
  });

  test("invalid stored bytes are rejected and absent from gallery", async ({ page }) => {
    await page.goto("/wedding-hub");
    await page.locator('input[type="file"]').setInputFiles({ name: `${PREFIX}invalid.png`, mimeType: "image/png", buffer: Buffer.from("Not an image") });
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("invalid_magic", { exact: true })).toBeVisible();
    const [row] = await rows();
    expect(row.verification_status).toBe("rejected");
    expect((await createE2eSupabaseAdminClient().storage.from(PHOTO_UPLOAD_BUCKET).info(row.storage_path)).data).toBeNull();
    await page.getByRole("button", { name: "Galleriet" }).click();
    await expect(page.locator(`a[href*="${row.storage_path}"]`)).toHaveCount(0);
  });

  test("finalizes first photo while second upload is delayed; retries only failed photo", async ({ page }) => {
    const first = `${PREFIX}first.png`;
    const second = `${PREFIX}second.png`;
    const signs: string[][] = [];
    page.on("request", request => {
      if (request.url().endsWith("/photos/sign")) {
        signs.push(request.postDataJSON().uploads.map((upload: { fileName: string }) => upload.fileName));
      }
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
    let sawSecond!: () => void;
    const secondStarted = new Promise<void>(resolve => { sawSecond = resolve; });
    await page.route(`**/storage/v1/object/upload/sign/**${second}*`, async route => {
      if (route.request().method() !== "PUT") return route.fallback();
      sawSecond();
      await secondGate;
      await route.abort("failed");
    }, { times: 1 });
    await pick(page, [first, second]);
    await page.getByPlaceholder("Lägg till kommentar").nth(0).fill("First survives slow second");
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    try {
      await secondStarted;
      // Correct seam: real second Storage PUT is held, not fake client time or app routes.
      await expect.poll(async () => (await rows()).filter(row => row.verification_status === "verified").map(row => row.original_filename), { timeout: 3_000 }).toEqual([first]);
      await expect(page.getByPlaceholder("Lägg till kommentar").last()).toBeDisabled();
      await expect(page.getByRole("button", { name: "Ta bort" }).last()).toBeDisabled();
      await expect(page.getByRole("button", { name: "Ladda upp bilder", exact: true })).toBeDisabled();
    } finally {
      releaseSecond();
    }
    await expect(page.getByRole("button", { name: /^Ladda upp \d/ })).toBeEnabled();
    expect(signs).toEqual([[first], [second]]);
    await expect(page.getByText(first, { exact: true })).toHaveCount(0);
    await expect(page.getByText("First survives slow second", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /^Ladda upp \d/ }).click();
    await expect(page.getByText("Valda filer", { exact: true })).toHaveCount(0);
    expect(signs).toEqual([[first], [second], [second]]);
    const uploaded = await rows();
    expect(uploaded).toHaveLength(2);
    for (const row of uploaded) {
      expect(row).toMatchObject({ verification_status: "verified", moderation_status: "approved", mime_type: "image/png", size_bytes: PNG.length, guest_id: null });
      const object = await createE2eSupabaseAdminClient().storage.from(PHOTO_UPLOAD_BUCKET).download(row.storage_path);
      expect(object.error).toBeNull();
      expect(Buffer.from(await object.data!.arrayBuffer())).toEqual(PNG);
    }
    await page.getByRole("button", { name: "Galleriet" }).click();
    for (const row of uploaded) {
      await expect(page.locator(`a[href*="${row.storage_path}"]`)).toBeVisible();
    }
  });
});
