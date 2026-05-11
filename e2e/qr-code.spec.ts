import { expect, type Page } from "@playwright/test";

import { GUEST_NAVIGATION_COOKIE_NAME } from "../lib/guest-navigation-session";
import { MAX_HUB_FILES_PER_REQUEST, PHOTO_UPLOAD_BUCKET } from "../lib/photo-upload";

import { signInAsSeededAdmin } from "./support/auth";
import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithWeddingSettings as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { invitePathForToken } from "./support/urls";
import {
  BASELINE_WEDDING_SETTINGS,
  updateWeddingSettings,
} from "./support/wedding-settings";

const E2E_PHOTO_PREFIX = "e2e-hub-upload";
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const ONE_BY_ONE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QE//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QE//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QE//Z",
  "base64",
);
const PADDED_PNG_OVER_HEADER_LIMIT = Buffer.concat([ONE_BY_ONE_PNG, Buffer.alloc(9_000)]);

type SignedIntentPayload = {
  clientId: string;
  uploadPath: string;
  uploadUrl: string;
  signedUploadClaim: string;
  thumbnailUploadUrl?: string;
  thumbnailClaim?: string;
};

function isSignedIntentPayload(value: unknown): value is SignedIntentPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "clientId" in value &&
    "uploadPath" in value &&
    "uploadUrl" in value &&
    "signedUploadClaim" in value &&
    typeof value.clientId === "string" &&
    typeof value.uploadPath === "string" &&
    typeof value.uploadUrl === "string" &&
    typeof value.signedUploadClaim === "string"
  );
}

async function deleteE2ePhotoUploads() {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("photo_uploads")
    .select("id, storage_path, thumbnail_storage_path")
    .like("original_filename", `${E2E_PHOTO_PREFIX}%`);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const storagePaths = rows.flatMap((row) => {
    const paths: string[] = [];

    if (typeof row.storage_path === "string") {
      paths.push(row.storage_path);
    }

    if (typeof row.thumbnail_storage_path === "string") {
      paths.push(row.thumbnail_storage_path);
    }

    return paths;
  });

  if (storagePaths.length > 0) {
    await supabase.storage.from(PHOTO_UPLOAD_BUCKET).remove(storagePaths);
  }

  const ids = rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
  if (ids.length > 0) {
    const deleteResult = await supabase.from("photo_uploads").delete().in("id", ids);
    if (deleteResult.error) {
      throw deleteResult.error;
    }
  }
}

async function uploadToSignedUrl(uploadUrl: string, bodyBytes: Buffer, type: string) {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", new Blob([new Uint8Array(bodyBytes)], { type }));

  const response = await fetch(uploadUrl, {
    body,
    headers: {
      "x-upsert": "false",
    },
    method: "PUT",
  });

  expect(response.ok).toBeTruthy();
}

async function getPhotoUploadByStoragePath(storagePath: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("photo_uploads")
    .select(
      "id, storage_path, guest_id, session_id, verification_status, moderation_status, thumbnail_status, thumbnail_storage_path, note",
    )
    .eq("storage_path", storagePath)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getGuestCookieHeader(page: Page) {
  const cookies = await page.context().cookies();
  const cookie = cookies.find((entry) => entry.name === GUEST_NAVIGATION_COOKIE_NAME);

  return cookie ? `${GUEST_NAVIGATION_COOKIE_NAME}=${cookie.value}` : null;
}

async function signAndFinalizePngUpload({
  page,
  clientId,
  fileName,
  note,
  cookieHeader,
  imageBytes = ONE_BY_ONE_PNG,
}: {
  page: Page;
  clientId: string;
  fileName: string;
  note: string;
  cookieHeader?: string | null;
  imageBytes?: Buffer;
}) {
  const headers = {
    "content-type": "application/json",
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
  };

  const signResponse = await page.request.post("/api/wedding-hub/photos/sign", {
    data: JSON.stringify({
      uploads: [
        {
          clientId,
          fileName,
          mimeType: "image/png",
          sizeBytes: imageBytes.byteLength,
          note,
        },
      ],
    }),
    headers,
  });

  expect(signResponse.ok()).toBeTruthy();
  const signPayload = await signResponse.json();
  expect(Array.isArray(signPayload.uploadIntents)).toBe(true);

  const intent = signPayload.uploadIntents.find(isSignedIntentPayload);
  expect(intent).toBeTruthy();

  if (!intent) {
    throw new Error("Missing signed intent");
  }

  await uploadToSignedUrl(intent.uploadUrl, imageBytes, "image/png");

  if (intent.thumbnailUploadUrl && intent.thumbnailClaim) {
    await uploadToSignedUrl(intent.thumbnailUploadUrl, ONE_BY_ONE_JPEG, "image/jpeg");
  }

  const finalizeResponse = await page.request.post("/api/wedding-hub/photos/finalize", {
    data: JSON.stringify({
      uploads: [
        {
          clientId,
          originalClaim: intent.signedUploadClaim,
          originalFileName: fileName,
          note,
          thumbnailClaim: intent.thumbnailClaim,
        },
      ],
    }),
    headers,
  });

  expect(finalizeResponse.ok()).toBeTruthy();
  const finalizePayload = await finalizeResponse.json();
  expect(finalizePayload.succeeded).toBe(1);

  return intent;
}

test.describe("wedding hub QR", () => {
  test.beforeEach(async () => {
    await deleteE2ePhotoUploads();
  });

  test.afterEach(async () => {
    await deleteE2ePhotoUploads();
  });

  test("admin can view, download, and open the shared hub QR", async ({ page }) => {
    const unauthenticatedQrResponse = await page.request.get("/admin/qr-code/png", {
      maxRedirects: 0,
    });
    expect(unauthenticatedQrResponse.status()).toBe(307);
    expect(unauthenticatedQrResponse.headers().location).toContain("/admin/login");

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage QR code" }).click();

    await expect(page.getByRole("heading", { name: "Wedding hub QR" })).toBeVisible();
    await expect(page.getByAltText("QR code for the wedding hub")).toBeVisible();
    await expect(page.getByLabel("Hub URL")).toHaveValue(/\/wedding-hub$/);
    await expect(page.getByRole("link", { name: "Download PNG" })).toHaveAttribute(
      "href",
      "/admin/qr-code/png?download=1",
    );
    await expect(page.getByRole("link", { name: "Open wedding hub" })).toHaveAttribute(
      "href",
      /\/wedding-hub$/,
    );

    const qrResponse = await page.request.get("/admin/qr-code/png");
    expect(qrResponse.ok()).toBeTruthy();
    expect(qrResponse.headers()["content-type"]).toContain("image/png");
    expect((await qrResponse.body()).byteLength).toBeGreaterThan(1_000);
  });

  test("public wedding hub shows live upload action and empty state", async ({
    page,
  }) => {
    await page.goto("/wedding-hub");

    await expect(page.getByRole("heading", { name: /Lägg till en låt/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ladda upp/ })).toBeVisible();
    await expect(page.getByText("Inga nya bidrag än")).toBeVisible();
    await page.getByRole("button", { name: "Galleriet" }).click();
    await expect(page.getByText("Galleriet är tomt")).toBeVisible();
    await expect(page.getByRole("link", { name: /Spellista/ })).toHaveAttribute(
      "href",
      BASELINE_WEDDING_SETTINGS.spotify_playlist_url,
    );
    await expect(page.getByRole("link", { name: /Lägg till låt/ })).toHaveAttribute(
      "href",
      BASELINE_WEDDING_SETTINGS.spotify_playlist_url,
    );
  });

  test("public wedding hub shows clear error for unsupported selected files", async ({
    page,
  }) => {
    await page.goto("/wedding-hub");

    await page.locator('input[type="file"]').setInputFiles({
      name: "not-a-photo.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a photo"),
    });

    await expect(page.getByText("not-a-photo.txt har en filtyp som inte stöds")).toBeVisible();
    await expect(page.getByText("Valda filer")).toHaveCount(0);
  });

  test("public wedding hub explains when anonymous uploads are disabled", async ({
    page,
  }) => {
    await updateWeddingSettings({ allow_anonymous_hub_upload: false });

    await page.goto("/wedding-hub");

    await expect(page.getByText("Gästuppladdning är avstängd")).toBeVisible();
  });

  test("sign endpoint rejects upload request without anonymous access", async ({
    page,
  }) => {
    await updateWeddingSettings({ allow_anonymous_hub_upload: false });

    const response = await page.request.post("/api/wedding-hub/photos/sign", {
      data: JSON.stringify({
        uploads: [
          {
            clientId: "e2e-1",
            fileName: "wedding-photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1024,
            note: "Hallå",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.status()).toBe(403);

    const payload = await response.json();

    expect(payload).toMatchObject({
      uploadAllowed: false,
      uploadIntents: [],
    });
  });

  test("finalize endpoint returns invalid claim for malformed signatures", async ({
    page,
  }) => {
    const encodedPayload = Buffer.from(JSON.stringify({ v: 1 })).toString("base64url");
    const malformedClaim = `${encodedPayload}.${"!".repeat(43)}`;

    const response = await page.request.post("/api/wedding-hub/photos/finalize", {
      data: JSON.stringify({
        uploads: [
          {
            clientId: "malformed-claim",
            originalClaim: malformedClaim,
            originalFileName: "malformed.png",
            note: "",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      results: [
        {
          clientId: "malformed-claim",
          reason: "invalid_claim",
          status: "error",
          success: false,
        },
      ],
    });
  });

  test("sign endpoint returns clear file-count errors", async ({
    page,
  }) => {
    const response = await page.request.post("/api/wedding-hub/photos/sign", {
      data: JSON.stringify({
        uploads: Array.from({ length: MAX_HUB_FILES_PER_REQUEST + 1 }, (_, index) => ({
          clientId: `too-many-${index}`,
          fileName: `wedding-photo-${index}.jpg`,
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          note: "",
        })),
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_file_count" });
  });

  test("sign endpoint returns upload intents when anonymous uploads are enabled", async ({
    page,
  }) => {
    const response = await page.request.post("/api/wedding-hub/photos/sign", {
      data: JSON.stringify({
        uploads: [
          {
            clientId: "e2e-2",
            fileName: "wedding-photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1024,
            note: "Hej",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.ok()).toBeTruthy();

    const payload = await response.json();

    expect(payload.uploadAllowed).toBeTruthy();
    expect(Array.isArray(payload.uploadIntents)).toBe(true);
    expect(payload.uploadIntents).toHaveLength(1);

    const first = payload.uploadIntents[0];
    expect(typeof first.signedUploadClaim).toBe("string");
    expect(first.uploadUrl).toMatch(/^https?:\/\//);

    const dataResponse = await page.request.get("/api/wedding-hub/photos");
    expect(dataResponse.ok()).toBeTruthy();

    const dataPayload = await dataResponse.json();

    expect(typeof dataPayload).toBe("object");
    expect(dataPayload).toHaveProperty("photos");
    expect(dataPayload).toHaveProperty("feed");
    expect(typeof dataPayload.photos?.totalPhotoCount).toBe("number");
    expect(Array.isArray(dataPayload.photos?.photos)).toBe(true);
    expect(Array.isArray(dataPayload.feed)).toBe(true);
  });

  test("anonymous guest can upload and finalize a photo with thumbnail", async ({
    page,
  }) => {
    const fileName = `${E2E_PHOTO_PREFIX}-anonymous.png`;
    const note = "Anonymous e2e upload";
    const intent = await signAndFinalizePngUpload({
      page,
      clientId: "e2e-anonymous-upload",
      fileName,
      note,
    });

    const row = await getPhotoUploadByStoragePath(intent.uploadPath);
    expect(row).toMatchObject({
      guest_id: null,
      moderation_status: "approved",
      note,
      storage_path: intent.uploadPath,
      thumbnail_status: "ready",
      verification_status: "verified",
    });
    expect(typeof row?.thumbnail_storage_path).toBe("string");

    const galleryResponse = await page.request.get("/api/wedding-hub/photos");
    expect(galleryResponse.ok()).toBeTruthy();

    const galleryPayload = await galleryResponse.json();
    expect(galleryPayload.photos.totalPhotoCount).toBeGreaterThanOrEqual(1);
    expect(
      galleryPayload.photos.photos.some(
        (photo: { id?: unknown; note?: unknown }) => photo.note === note,
      ),
    ).toBeTruthy();
  });

  test("anonymous guest can upload and finalize a PNG larger than the header verification window", async ({
    page,
  }) => {
    const fileName = `${E2E_PHOTO_PREFIX}-large-header.png`;
    const note = "Large header e2e upload";
    const intent = await signAndFinalizePngUpload({
      page,
      clientId: "e2e-large-header-upload",
      fileName,
      note,
      imageBytes: PADDED_PNG_OVER_HEADER_LIMIT,
    });

    const row = await getPhotoUploadByStoragePath(intent.uploadPath);
    expect(row).toMatchObject({
      moderation_status: "approved",
      note,
      storage_path: intent.uploadPath,
      verification_status: "verified",
    });
  });

  test("guest navigation cookie attributes finalized photo uploads", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Hub Upload Attribution");
    const token = uniqueInviteToken("hub-upload-attribution");
    const { guestId } = await createInviteTestGuest({
      email: "e2e-hub-upload-attribution@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();

    const cookieHeader = await getGuestCookieHeader(page);
    expect(cookieHeader).toBeTruthy();

    const fileName = `${E2E_PHOTO_PREFIX}-attributed.png`;
    const note = "Attributed e2e upload";
    const intent = await signAndFinalizePngUpload({
      page,
      clientId: "e2e-attributed-upload",
      fileName,
      note,
      cookieHeader,
    });

    const row = await getPhotoUploadByStoragePath(intent.uploadPath);
    expect(row).toMatchObject({
      guest_id: guestId,
      moderation_status: "approved",
      note,
      storage_path: intent.uploadPath,
      thumbnail_status: "ready",
      verification_status: "verified",
    });
    expect(typeof row?.session_id).toBe("string");
  });

  test("valid guest cookie can upload when anonymous uploads are disabled", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Hub Upload Disabled Anonymous");
    const token = uniqueInviteToken("hub-upload-disabled-anonymous");
    await createInviteTestGuest({
      email: "e2e-hub-upload-disabled-anonymous@example.com",
      fullName: guestName,
      token,
    });

    await page.goto(invitePathForToken(token));
    await expect(page.getByText(`Private invite for ${guestName}`)).toBeVisible();
    const cookieHeader = await getGuestCookieHeader(page);
    expect(cookieHeader).toBeTruthy();
    await updateWeddingSettings({ allow_anonymous_hub_upload: false });

    const response = await page.request.post("/api/wedding-hub/photos/sign", {
      data: JSON.stringify({
        uploads: [
          {
            clientId: "e2e-cookie-allowed",
            fileName: `${E2E_PHOTO_PREFIX}-cookie-allowed.png`,
            mimeType: "image/png",
            sizeBytes: ONE_BY_ONE_PNG.byteLength,
            note: "Cookie allowed",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
    });

    expect(response.ok()).toBeTruthy();
  });
});
