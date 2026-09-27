import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { PHOTO_UPLOAD_BUCKET } from "../lib/photo-upload";
import { getHubWedding } from "../lib/wedding-hub";
import { parseHubPhotoCursor } from "../lib/wedding-hub-photo-cursor";
import { getWeddingHubPhotoData, type HubPhotoData } from "../lib/wedding-hub-photo-verification";
import { requireEnv } from "./support/env";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWLa7KXzH4SZGKAAAAAA//93sH6uAAAABklEQVQDADm6BFWM5cf8AAAAAElFTkSuQmCC", "base64");
const PREFIX = `e2e-hub-pagination-${randomUUID()}`;
const tiedTime = "2099-09-27T12:00:00.123456Z";
const db = createE2eSupabaseAdminClient();
const ownedRows: ReturnType<typeof photoRow>[] = [];
let baselineCount = 0;

function photoRow(createdAt: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    wedding_id: SEEDED_WEDDING_ID,
    storage_path: `${SEEDED_WEDDING_ID}/${PREFIX}/${id}.png`,
    original_filename: `${PREFIX}-${id}.png`,
    note: `${PREFIX}-${id}`,
    mime_type: "image/png",
    size_bytes: PNG.length,
    verification_status: "verified",
    moderation_status: "approved",
    verified_at: createdAt,
    created_at: createdAt,
    ...overrides,
  };
}

const galleryRows = Array.from({ length: 65 }, (_, index) => photoRow(
  index < 2 ? "2099-09-27T12:00:00.123457Z" : index < 63 ? tiedTime : "2099-09-27T12:00:00.123455Z",
)).sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));

async function addRows(rows: ReturnType<typeof photoRow>[]) {
  ownedRows.push(...rows);
  // Real objects ensure both signing and the viewer use local Storage.
  for (let start = 0; start < rows.length; start += 10) {
    const uploads = await Promise.all(rows.slice(start, start + 10).map(row =>
      db.storage.from(PHOTO_UPLOAD_BUCKET).upload(row.storage_path, PNG, { contentType: "image/png" }),
    ));
    for (const upload of uploads) expect(upload.error).toBeNull();
  }
  expect((await db.from("photo_uploads").insert(rows)).error).toBeNull();
}

async function photos(request: APIRequestContext, cursor?: string): Promise<HubPhotoData> {
  const response = await request.get("/api/wedding-hub/photos", { params: cursor ? { cursor } : {} });
  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe("Wedding hub gallery pagination", () => {
  test.beforeAll(async () => {
    const url = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL"));
    expect(url.protocol).toBe("http:");
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
    expect(url.port).toBe("54321");
    const baseline = await db.from("photo_uploads").select("id", { head: true, count: "exact" })
      .eq("wedding_id", SEEDED_WEDDING_ID).eq("verification_status", "verified")
      .eq("moderation_status", "approved").is("deleted_at", null);
    expect(baseline.error).toBeNull();
    baselineCount = baseline.count ?? 0;
    await addRows(galleryRows);
    await addRows([
      photoRow("2099-09-28T00:00:00Z", { moderation_status: "hidden" }),
      photoRow("2099-09-28T00:00:00Z", { moderation_status: "pending" }),
      photoRow("2099-09-28T00:00:00Z", { verification_status: "pending", verified_at: null }),
      photoRow("2099-09-28T00:00:00Z", { deleted_at: "2099-09-28T00:00:00Z" }),
    ]);
  });

  test.afterAll(async () => {
    if (!ownedRows.length) return;
    expect((await db.from("photo_uploads").delete().in("id", ownedRows.map(row => row.id))).error).toBeNull();
    expect((await db.storage.from(PHOTO_UPLOAD_BUCKET).remove(ownedRows.map(row => row.storage_path))).error).toBeNull();
  });

  test("older pages retain timestamp ties and microseconds while newer uploads arrive", async ({ request }) => {
    const first = await photos(request);
    expect(first.photos.photos.map(photo => photo.id)).toEqual(galleryRows.slice(0, 60).map(row => row.id));
    expect(first.photos.totalPhotoCount).toBe(baselineCount + 65);
    expect(first.photos.nextCursor).not.toBeNull();
    expect(parseHubPhotoCursor(first.photos.nextCursor!)?.createdAt).toBe("2099-09-27T12:00:00.123456+00:00");

    const newcomer = photoRow("2099-09-27T12:00:00.123458Z");
    await addRows([newcomer]);
    try {
      const second = await photos(request, first.photos.nextCursor!);
      expect(second.photos.photos.slice(0, 5).map(photo => photo.id)).toEqual(galleryRows.slice(60).map(row => row.id));
      expect(second.photos.totalPhotoCount).toBe(baselineCount + 66);
      const visibleSeedIds = [...first.photos.photos, ...second.photos.photos]
        .filter(photo => galleryRows.some(row => row.id === photo.id)).map(photo => photo.id);
      expect(visibleSeedIds).toEqual(galleryRows.map(row => row.id));
      expect(new Set(visibleSeedIds).size).toBe(65);
      expect(second.photos.photos.some(photo => photo.id === newcomer.id)).toBe(false);
      expect((await photos(request)).photos.photos[0].id).toBe(newcomer.id);
      if (baselineCount < 55) expect(second.photos.nextCursor).toBeNull();
    } finally {
      expect((await db.from("photo_uploads").delete().eq("id", newcomer.id)).error).toBeNull();
    }
  });

  test("gallery retries a failed older-page request, keeps current pictures, and opens an early photo", async ({ page }) => {
    let failNextPage = true;
    await page.route("**/api/wedding-hub/photos?*", async route => {
      if (failNextPage) {
        failNextPage = false;
        await route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
      } else {
        await route.continue();
      }
    });
    await page.goto("/wedding-hub");
    await page.getByRole("button", { name: "Galleriet", exact: true }).click();
    const newest = page.locator(`button[data-photo-id="${galleryRows[0].id}"]`);
    const oldest = page.locator(`button[data-photo-id="${galleryRows[64].id}"]`);
    await expect(newest).toBeVisible();
    await expect(oldest).toHaveCount(0);
    const more = page.getByRole("button", { name: "Ladda fler bilder", exact: true });
    await more.click();
    const error = page.getByRole("alert").filter({ hasText: "Kunde inte" });
    await expect(error).toBeVisible();
    await expect(newest).toBeVisible();
    await expect(oldest).toHaveCount(0);
    await page.getByRole("button", { name: "Försök igen", exact: true }).click();
    await expect(oldest).toBeVisible();
    await expect(error).toHaveCount(0);
    await expect(newest).toBeVisible();
    await oldest.click();
    const viewer = page.getByRole("dialog", { name: "Våra bilder" });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByLabel("Bildtext")).toContainText(galleryRows[64].note);
    await expect(viewer.getByRole("img")).toBeVisible();
    await expect.poll(() => viewer.getByRole("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  });

  test("invalid and injected cursors are rejected before querying", async ({ request }) => {
    const invalidValues = [
      "",
      "not-a-cursor",
      "x".repeat(513),
      Buffer.from(JSON.stringify({ v: 1, createdAt: tiedTime, id: "id),moderation_status.eq.hidden" })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, createdAt: "2099-02-31T12:00:00Z", id: galleryRows[0].id })).toString("base64url"),
    ];
    for (const cursor of invalidValues) {
      const response = await request.get("/api/wedding-hub/photos", { params: { cursor } });
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_cursor" });
    }
  });

  test("query failures do not become a successful empty final page", async () => {
    const wedding = await getHubWedding({ supabase: db });
    expect(wedding).not.toBeNull();
    const failingDb = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/rest/v1/photo_uploads")) {
          return Promise.resolve(Response.json({ message: "Temporary database outage" }, { status: 503 }));
        }
        return fetch(input, init);
      } },
    });
    await expect(getWeddingHubPhotoData({ supabase: failingDb, wedding: wedding! }))
      .rejects.toThrow("Failed to load hub photos");
  });
});
