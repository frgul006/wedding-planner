import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { PHOTO_UPLOAD_BUCKET } from "../lib/photo-upload";
import type { HubWedding } from "../lib/wedding-hub";
import { getWeddingHubPhotoData } from "../lib/wedding-hub-photo-verification";

const wedding: HubWedding = {
  id: "00000000-0000-0000-0000-000000000001",
  allow_anonymous_hub_upload: true,
  photo_upload_requires_review: false,
  name: "Gallery signing test",
  partner_one_name: null,
  partner_two_name: null,
  spotify_playlist_url: null,
  time_plan: [],
  venue_name: null,
  wedding_date: null,
};

function photoRow(index: number) {
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    storage_path: `originals/${index}.png`,
    note: `Photo ${index}`,
    created_at: "2026-09-27T12:00:00.123456+00:00",
    thumbnail_status: "ready",
    thumbnail_storage_path: `thumbnails/${index}.png` as string | null,
    guests: { full_name: `Guest ${index}` },
  };
}

type SignedObject = { path: string | null; signedURL: string | null; error: string | null };
const signedObject = (path: string): SignedObject => ({
  path,
  signedURL: `/object/sign/${PHOTO_UPLOAD_BUCKET}/${path}?token=test-token`,
  error: null,
});
const signedUrl = (path: string) => `http://storage.test/storage/v1${signedObject(path).signedURL}`;

function harness(rows: ReturnType<typeof photoRow>[], {
  total = 128,
  results = (paths: string[]) => paths.map(signedObject).reverse(),
  batchStatus = 200,
}: {
  total?: number;
  results?: (paths: string[]) => SignedObject[];
  batchStatus?: number;
} = {}) {
  const signingRequests: Array<{ path: string; body: { paths?: string[]; expiresIn: number } }> = [];
  const supabase = createClient("http://storage.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/rest/v1/photo_uploads") {
        if (request.method === "HEAD") {
          return new Response(null, { headers: { "content-range": `0-0/${total}` } });
        }
        return Response.json(rows);
      }
      const signingPath = `/storage/v1/object/sign/${PHOTO_UPLOAD_BUCKET}`;
      if (request.method === "POST" && url.pathname.startsWith(signingPath)) {
        const body = await request.json();
        signingRequests.push({ path: url.pathname, body });
        if (url.pathname === signingPath) {
          if (batchStatus !== 200) return Response.json({ message: "Storage unavailable" }, { status: batchStatus });
          return Response.json(results(body.paths));
        }
        // Support the previous single-object implementation so its regression is
        // the network waterfall, not an unsupported fake endpoint.
        return Response.json(signedObject(url.pathname.slice(signingPath.length + 1)));
      }
      throw new Error(`Unexpected gallery request: ${request.method} ${url.pathname}`);
    } },
  });
  return { supabase, signingRequests };
}

test("a full gallery page signs unique originals and thumbnails in one request and retains photo order", async () => {
  const rows = Array.from({ length: 60 }, (_, index) => photoRow(index));
  rows[59].storage_path = rows[0].storage_path;
  rows[59].thumbnail_storage_path = rows[0].thumbnail_storage_path;
  const fake = harness(rows);
  const data = await getWeddingHubPhotoData({ supabase: fake.supabase, wedding });

  expect(data.photos.photos.map(photo => photo.id)).toEqual(rows.map(row => row.id));
  expect(fake.signingRequests).toHaveLength(1);
  expect(fake.signingRequests[0]).toEqual({
    path: `/storage/v1/object/sign/${PHOTO_UPLOAD_BUCKET}`,
    body: {
      expiresIn: 3600,
      paths: [...new Set(rows.flatMap(row => [row.storage_path, row.thumbnail_storage_path!]))],
    },
  });
  expect(data.photos.totalPhotoCount).toBe(128);
  expect(data.photos.nextCursor).toBeNull();
  expect(data.photos.photos.map(photo => [photo.photoUrl, photo.thumbnailUrl])).toEqual(
    rows.map(row => [signedUrl(row.storage_path), signedUrl(row.thumbnail_storage_path!)]),
  );
  expect(data.feed.map(photo => [photo.id, photo.photoUrl, photo.thumbnailUrl])).toEqual(
    rows.map(row => [row.id, signedUrl(row.storage_path), signedUrl(row.thumbnail_storage_path!)]),
  );
});

test("partial signing failures omit originals and fall back to originals for unavailable thumbnails", async () => {
  const rows = Array.from({ length: 13 }, (_, index) => photoRow(index));
  rows[6].thumbnail_status = "pending";
  rows[7].thumbnail_storage_path = null;
  rows[8].thumbnail_status = "failed";
  rows[9].thumbnail_status = "unavailable";
  const missing = new Set([rows[5].storage_path, rows[11].thumbnail_storage_path]);
  const errors = new Set([rows[1].storage_path, rows[3].thumbnail_storage_path]);
  const missingPaths = new Set([rows[2].storage_path, rows[12].thumbnail_storage_path]);
  const missingUrls = new Set([rows[10].storage_path, rows[4].thumbnail_storage_path]);
  const fake = harness(rows, {
    results: paths => paths.filter(path => !missing.has(path)).map(path => ({
      ...signedObject(path),
      ...(errors.has(path) ? { error: "Object unavailable" } : {}),
      ...(missingPaths.has(path) ? { path: null } : {}),
      ...(missingUrls.has(path) ? { signedURL: null } : {}),
    })).reverse(),
  });
  const data = await getWeddingHubPhotoData({ supabase: fake.supabase, wedding });

  const visible = [0, 3, 4, 6, 7, 8, 9, 11, 12].map(index => rows[index]);
  expect(data.photos.photos.map(photo => photo.id)).toEqual(visible.map(row => row.id));
  expect(data.feed.map(photo => photo.id)).toEqual(visible.map(row => row.id));
  expect(data.photos.totalPhotoCount).toBe(128);
  expect(data.photos.photos[0].thumbnailUrl).toBe(signedUrl(rows[0].thumbnail_storage_path!));
  for (const photo of data.photos.photos.slice(1)) expect(photo.thumbnailUrl).toBe(photo.photoUrl);
  expect(data.feed.map(photo => [photo.photoUrl, photo.thumbnailUrl])).toEqual(
    data.photos.photos.map(photo => [photo.photoUrl, photo.thumbnailUrl]),
  );
  expect(fake.signingRequests).toHaveLength(1);
  const requested = fake.signingRequests[0].body.paths!;
  for (const index of [6, 8, 9]) expect(requested).not.toContain(rows[index].thumbnail_storage_path);
  expect(requested).toHaveLength(22);
});

test("pagination signs only its visible page and keeps the database boundary after an original fails", async () => {
  const rows = Array.from({ length: 61 }, (_, index) => photoRow(index));
  const fake = harness(rows, {
    results: paths => paths.filter(path => path !== rows[59].storage_path).map(signedObject).reverse(),
  });
  const data = await getWeddingHubPhotoData({ supabase: fake.supabase, wedding });

  expect(data.photos.photos).toHaveLength(59);
  expect(data.photos.totalPhotoCount).toBe(128);
  expect(data.photos.nextCursor).not.toBeNull();
  expect(JSON.parse(Buffer.from(data.photos.nextCursor!, "base64url").toString("utf8"))).toEqual({
    v: 1, createdAt: rows[59].created_at, id: rows[59].id,
  });
  expect(fake.signingRequests).toHaveLength(1);
  expect(fake.signingRequests[0].body.paths).toHaveLength(120);
  expect(fake.signingRequests[0].body.paths).not.toContain(rows[60].storage_path);
  expect(fake.signingRequests[0].body.paths).not.toContain(rows[60].thumbnail_storage_path);
});

test("a whole-batch failure remains retryable without per-object signing fallback", async () => {
  const fake = harness([photoRow(0), photoRow(1)], { batchStatus: 503 });
  await expect(getWeddingHubPhotoData({ supabase: fake.supabase, wedding }))
    .rejects.toThrow("Failed to sign hub photos");
  expect(fake.signingRequests.length).toBeGreaterThan(0);
  expect(fake.signingRequests.every(request => request.path === `/storage/v1/object/sign/${PHOTO_UPLOAD_BUCKET}`)).toBe(true);
});

test("an empty gallery makes no Storage signing request", async () => {
  const fake = harness([], { total: 0 });
  expect(await getWeddingHubPhotoData({ supabase: fake.supabase, wedding })).toEqual({
    photos: { photos: [], totalPhotoCount: 0, nextCursor: null }, feed: [],
  });
  expect(fake.signingRequests).toEqual([]);
});
