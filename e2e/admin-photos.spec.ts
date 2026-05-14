import { expect, type Page } from "@playwright/test";

import { PHOTO_UPLOAD_BUCKET } from "../lib/photo-upload";

import { signInAsSeededAdmin } from "./support/auth";
import { testWithWeddingSettings as test } from "./support/fixtures";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import { SEEDED_WEDDING_ID } from "./support/test-data";
import { updateWeddingSettings } from "./support/wedding-settings";

const E2E_PHOTO_PREFIX = "e2e-admin-photo";
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const ONE_BY_ONE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QE//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QE//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QE//Z",
  "base64",
);
const INVALID_PNG_BYTES = Buffer.from("this is not a png image");

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

async function signAndFinalizePngUpload({
  clientId,
  fileName,
  imageBytes = ONE_BY_ONE_PNG,
  note,
  page,
}: {
  clientId: string;
  fileName: string;
  imageBytes?: Buffer;
  note: string;
  page: Page;
}) {
  const signResponse = await page.request.post("/api/wedding-hub/photos/sign", {
    data: JSON.stringify({
      uploads: [
        {
          clientId,
          fileName,
          mimeType: "image/png",
          note,
          sizeBytes: imageBytes.byteLength,
        },
      ],
    }),
    headers: {
      "content-type": "application/json",
    },
  });

  expect(signResponse.ok()).toBeTruthy();
  const signPayload = await signResponse.json();
  const intent = Array.isArray(signPayload.uploadIntents)
    ? signPayload.uploadIntents.find(isSignedIntentPayload)
    : null;

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
          note,
          originalClaim: intent.signedUploadClaim,
          originalFileName: fileName,
          thumbnailClaim: intent.thumbnailClaim,
        },
      ],
    }),
    headers: {
      "content-type": "application/json",
    },
  });

  expect(finalizeResponse.ok()).toBeTruthy();
  const finalizePayload = await finalizeResponse.json();

  return { finalizePayload, intent };
}

async function insertDeletedPaginationRows(count: number) {
  const supabase = createE2eSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("photo_uploads").insert(
    Array.from({ length: count }, (_, index) => ({
      created_at: new Date(Date.now() - index * 1000).toISOString(),
      deleted_at: now,
      mime_type: "image/png",
      moderation_status: "hidden",
      original_filename: `${E2E_PHOTO_PREFIX}-pagination-${String(index + 1).padStart(2, "0")}.png`,
      size_bytes: 1,
      storage_path: `${SEEDED_WEDDING_ID}/originals/${E2E_PHOTO_PREFIX}-pagination-${index + 1}.png`,
      verification_status: "verified",
      verified_at: now,
      wedding_id: SEEDED_WEDDING_ID,
    })),
  );

  if (error) {
    throw error;
  }
}

async function getPhotoUploadByStoragePath(storagePath: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("photo_uploads")
    .select(
      "id, storage_path, verification_status, moderation_status, deleted_at, thumbnail_storage_path, note",
    )
    .eq("storage_path", storagePath)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function expectPublicGalleryNote(page: Page, note: string, expected: boolean) {
  const response = await page.request.get("/api/wedding-hub/photos");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const hasNote = payload.photos?.photos?.some(
    (photo: { note?: unknown }) => photo.note === note,
  );

  expect(Boolean(hasNote)).toBe(expected);
}

function readUint16(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function readUint32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function listZipEntryNames(buffer: Buffer) {
  let eocdOffset = -1;

  for (let offset = buffer.byteLength - 22; offset >= 0; offset -= 1) {
    if (readUint32(buffer, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("Missing ZIP end of central directory");
  }

  const entryCount = readUint16(buffer, eocdOffset + 10);
  let centralOffset = readUint32(buffer, eocdOffset + 16);
  const decoder = new TextDecoder();
  const names: string[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(buffer, centralOffset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory");
    }

    const nameLength = readUint16(buffer, centralOffset + 28);
    const extraLength = readUint16(buffer, centralOffset + 30);
    const commentLength = readUint16(buffer, centralOffset + 32);
    const nameStart = centralOffset + 46;
    names.push(decoder.decode(buffer.subarray(nameStart, nameStart + nameLength)));
    centralOffset = nameStart + nameLength + extraLength + commentLength;
  }

  return names;
}

async function getExportEntryNames(page: Page) {
  const response = await page.request.get("/admin/photos/export");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/zip");
  return listZipEntryNames(await response.body());
}

test.describe("admin photo moderation", () => {
  test.beforeEach(async () => {
    await deleteE2ePhotoUploads();
  });

  test.afterEach(async () => {
    await deleteE2ePhotoUploads();
  });

  test("protects the approved photo ZIP export", async ({ page }) => {
    const response = await page.request.get("/admin/photos/export", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/admin/login");
  });

  test("auto-approves verified uploads when review is off", async ({ page }) => {
    const approvedFileName = `${E2E_PHOTO_PREFIX}-review-off-export.png`;
    const approvedNote = "E2E review off approved admin photo";
    const { finalizePayload, intent } = await signAndFinalizePngUpload({
      clientId: "e2e-admin-review-off",
      fileName: approvedFileName,
      note: approvedNote,
      page,
    });

    expect(finalizePayload).toMatchObject({ succeeded: 1 });
    await expect(getPhotoUploadByStoragePath(intent.uploadPath)).resolves.toMatchObject({
      moderation_status: "approved",
      note: approvedNote,
      verification_status: "verified",
    });
    await expectPublicGalleryNote(page, approvedNote, true);

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage photos" }).click();
    await expect(page.getByText("Auto-refreshing every 15 seconds")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh now" })).toBeVisible();

    const approvedCard = page.locator("article", { hasText: approvedFileName });
    await expect(approvedCard.getByText("approved", { exact: true })).toBeVisible();

    const exportEntries = await getExportEntryNames(page);
    expect(exportEntries.some((name) => name.includes("review-off-export"))).toBe(true);
  });

  test("paginates larger admin photo lists", async ({ page }) => {
    await insertDeletedPaginationRows(55);
    await signInAsSeededAdmin(page);
    await page.goto("/admin/photos");

    await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();
    await expect(page.getByText("Showing 1-50 of 55 uploads")).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText("Showing 51-55 of 55 uploads")).toBeVisible();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
  });

  test("keeps rejected uploads out of public gallery and export", async ({ page }) => {
    const rejectedFileName = `${E2E_PHOTO_PREFIX}-rejected-export.png`;
    const rejectedNote = "E2E rejected admin moderation photo";
    const { finalizePayload, intent } = await signAndFinalizePngUpload({
      clientId: "e2e-admin-rejected",
      fileName: rejectedFileName,
      imageBytes: INVALID_PNG_BYTES,
      note: rejectedNote,
      page,
    });

    expect(finalizePayload).toMatchObject({
      results: [
        {
          reason: "invalid_magic",
          status: "rejected",
          success: false,
        },
      ],
      succeeded: 0,
    });
    await expect(getPhotoUploadByStoragePath(intent.uploadPath)).resolves.toMatchObject({
      note: rejectedNote,
      verification_status: "rejected",
    });
    await expectPublicGalleryNote(page, rejectedNote, false);

    await signInAsSeededAdmin(page);
    await page.goto("/admin/photos?filter=rejected");
    await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();

    const rejectedCard = page.locator("article", { hasText: rejectedFileName });
    await expect(rejectedCard.getByText("rejected", { exact: true })).toBeVisible();
    await expect(rejectedCard.getByText("Excluded from public/export")).toBeVisible();

    const exportEntries = await getExportEntryNames(page);
    expect(exportEntries.some((name) => name.includes("rejected-export"))).toBe(false);
  });

  test("skips missing approved storage objects without corrupting export", async ({ page }) => {
    const missingFileName = `${E2E_PHOTO_PREFIX}-missing-object.png`;
    const missingNote = "E2E missing object export warning photo";
    const { finalizePayload, intent } = await signAndFinalizePngUpload({
      clientId: "e2e-admin-missing-object",
      fileName: missingFileName,
      note: missingNote,
      page,
    });

    expect(finalizePayload).toMatchObject({ succeeded: 1 });

    const supabase = createE2eSupabaseAdminClient();
    const removeResult = await supabase.storage
      .from(PHOTO_UPLOAD_BUCKET)
      .remove([intent.uploadPath]);
    expect(removeResult.error).toBeNull();

    await signInAsSeededAdmin(page);
    const exportEntries = await getExportEntryNames(page);
    expect(exportEntries.some((name) => name.includes("missing-object"))).toBe(false);
    expect(exportEntries).toContain("EXPORT-WARNINGS.txt");
  });

  test("approves, hides, deletes, and exports only accepted photos", async ({ page }) => {
    await updateWeddingSettings({ photo_upload_requires_review: true });

    const pendingFileName = `${E2E_PHOTO_PREFIX}-pending-export.png`;
    const pendingNote = "E2E pending admin moderation photo";
    const { finalizePayload: pendingFinalizePayload, intent: pendingIntent } = await signAndFinalizePngUpload({
      clientId: "e2e-admin-pending",
      fileName: pendingFileName,
      note: pendingNote,
      page,
    });

    expect(pendingFinalizePayload).toMatchObject({ succeeded: 1 });

    await expect(getPhotoUploadByStoragePath(pendingIntent.uploadPath)).resolves.toMatchObject({
      moderation_status: "pending",
      note: pendingNote,
      verification_status: "verified",
    });
    await expectPublicGalleryNote(page, pendingNote, false);

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage photos" }).click();
    await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();

    const exportBeforeApproval = await getExportEntryNames(page);
    expect(exportBeforeApproval.some((name) => name.includes("pending-export"))).toBe(false);

    let pendingCard = page.locator("article", { hasText: pendingFileName });
    await expect(pendingCard.getByText("verified")).toBeVisible();
    await expect(pendingCard.getByText("pending review")).toBeVisible();

    await pendingCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Photo approved.")).toBeVisible();
    pendingCard = page.locator("article", { hasText: pendingFileName });
    await expect(pendingCard.getByText("approved")).toBeVisible();
    await expectPublicGalleryNote(page, pendingNote, true);

    const exportAfterApproval = await getExportEntryNames(page);
    expect(exportAfterApproval.some((name) => name.includes("pending-export"))).toBe(true);

    await pendingCard.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByText("Photo hidden from public gallery and export.")).toBeVisible();
    pendingCard = page.locator("article", { hasText: pendingFileName });
    await expect(pendingCard.getByText("hidden")).toBeVisible();
    await expectPublicGalleryNote(page, pendingNote, false);

    const exportAfterHide = await getExportEntryNames(page);
    expect(exportAfterHide.some((name) => name.includes("pending-export"))).toBe(false);

    const deleteFileName = `${E2E_PHOTO_PREFIX}-delete-export.png`;
    const deleteNote = "E2E deleted admin moderation photo";
    const { finalizePayload: deleteFinalizePayload, intent: deleteIntent } = await signAndFinalizePngUpload({
      clientId: "e2e-admin-delete",
      fileName: deleteFileName,
      note: deleteNote,
      page,
    });

    expect(deleteFinalizePayload).toMatchObject({ succeeded: 1 });

    await page.reload();
    let deleteCard = page.locator("article", { hasText: deleteFileName });
    await expect(deleteCard.getByText("pending review")).toBeVisible();
    await deleteCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Photo approved.")).toBeVisible();
    deleteCard = page.locator("article", { hasText: deleteFileName });
    await expect(deleteCard.getByText("approved")).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(deleteFileName);
      await dialog.accept();
    });
    await deleteCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Photo deleted and removed from public gallery/export.")).toBeVisible();

    const deletedRow = await getPhotoUploadByStoragePath(deleteIntent.uploadPath);
    expect(deletedRow).toMatchObject({
      moderation_status: "hidden",
      note: deleteNote,
      verification_status: "verified",
    });
    expect(typeof deletedRow?.deleted_at).toBe("string");
    await expectPublicGalleryNote(page, deleteNote, false);

    const supabase = createE2eSupabaseAdminClient();
    const storageInfo = await supabase.storage
      .from(PHOTO_UPLOAD_BUCKET)
      .info(deleteIntent.uploadPath);
    expect(storageInfo.data).toBeNull();

    const exportAfterDelete = await getExportEntryNames(page);
    expect(exportAfterDelete.some((name) => name.includes("delete-export"))).toBe(false);
  });
});
