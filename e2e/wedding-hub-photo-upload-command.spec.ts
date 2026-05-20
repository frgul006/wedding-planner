import { expect, test } from "@playwright/test";

import {
  MAX_HUB_FILES_PER_REQUEST,
  MAX_PHOTO_NOTE_LENGTH,
} from "../lib/photo-upload";
import type { HubContext } from "../lib/wedding-hub-access";
import {
  finalizeHubPhotoUploadsCommand,
  signHubPhotoUploadsCommand,
} from "../lib/wedding-hub-photo-upload-command";
import type { HubPhotoUploadSigningAdapter } from "../lib/wedding-hub-photo-upload";
import type { FinalizeResult } from "../lib/wedding-hub-photo-verification";

class FakeSigningAdapter implements HubPhotoUploadSigningAdapter {
  readonly calls: Array<{ options: { upsert: boolean }; path: string }> = [];
  failAfterCalls: number | null = null;

  async createSignedUploadUrl(path: string, options: { upsert: boolean }) {
    this.calls.push({ options, path });

    if (this.failAfterCalls !== null && this.calls.length > this.failAfterCalls) {
      return null;
    }

    return {
      signedUrl: `https://uploads.test/${encodeURIComponent(path)}`,
      token: `token:${path}`,
    };
  }
}

const originalSigningSecret = process.env.PHOTO_UPLOAD_SIGNING_SECRET;

function hubContext({
  requiresReview = false,
  uploadAllowed = true,
}: {
  requiresReview?: boolean;
  uploadAllowed?: boolean;
} = {}): HubContext {
  return {
    attribution: {
      guestName: null,
      guestNavigationSession: null,
    },
    uploadAllowed,
    wedding: {
      allow_anonymous_hub_upload: uploadAllowed,
      id: "wedding-1",
      name: "Wedding",
      partner_one_name: "F",
      partner_two_name: "M",
      photo_upload_requires_review: requiresReview,
      spotify_playlist_url: null,
      time_plan: [],
      venue_name: null,
      wedding_date: null,
    },
  };
}

function successfulFinalizeResult(clientId: string): FinalizeResult {
  return {
    clientId,
    photoId: `photo-${clientId}`,
    photoStoragePath: `wedding-1/originals/${clientId}.png`,
    reason: null,
    status: "verified",
    success: true,
    thumbnailStatus: "ready",
  };
}

function failedFinalizeResult(clientId: string): FinalizeResult {
  return {
    clientId,
    photoId: null,
    photoStoragePath: "",
    reason: "invalid_claim",
    status: "error",
    success: false,
    thumbnailStatus: "unavailable",
  };
}

test.beforeEach(() => {
  process.env.PHOTO_UPLOAD_SIGNING_SECRET = "test-photo-upload-secret";
});

test.afterEach(() => {
  if (originalSigningSecret === undefined) {
    delete process.env.PHOTO_UPLOAD_SIGNING_SECRET;
  } else {
    process.env.PHOTO_UPLOAD_SIGNING_SECRET = originalSigningSecret;
  }
});

test.describe("Wedding hub photo upload command Module", () => {
  test("rejects invalid sign payloads before loading Wedding hub access", async () => {
    const signingAdapter = new FakeSigningAdapter();
    let contextLoads = 0;

    const result = await signHubPhotoUploadsCommand({
      body: { uploads: "not-an-array" },
      loadHubContext: async () => {
        contextLoads += 1;
        return hubContext();
      },
      signingAdapter,
    });

    expect(result).toEqual({ body: { error: "invalid_payload" }, httpStatus: 400 });
    expect(contextLoads).toBe(0);
    expect(signingAdapter.calls).toEqual([]);
  });

  test("returns denied sign body from Wedding hub access", async () => {
    const signingAdapter = new FakeSigningAdapter();

    const result = await signHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "client-1",
            fileName: "photo.png",
            mimeType: "image/png",
            sizeBytes: 123,
          },
        ],
      },
      loadHubContext: async () => hubContext({ requiresReview: true, uploadAllowed: false }),
      signingAdapter,
    });

    expect(result).toEqual({
      body: {
        maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
        requiresReview: true,
        uploadAllowed: false,
        uploadIntents: [],
      },
      httpStatus: 403,
    });
    expect(signingAdapter.calls).toEqual([]);
  });

  test("signs originals and thumbnails behind a signing Adapter", async () => {
    const signingAdapter = new FakeSigningAdapter();

    const result = await signHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "",
            fileName: "photo.png",
            mimeType: "image/png",
            note: "x".repeat(MAX_PHOTO_NOTE_LENGTH + 1),
            sizeBytes: 123,
          },
        ],
      },
      loadHubContext: async () => hubContext({ requiresReview: true }),
      newFileId: () => "file-id-1",
      signingAdapter,
    });

    expect(result.httpStatus).toBe(200);
    expect(signingAdapter.calls).toEqual([
      { options: { upsert: false }, path: "wedding-1/originals/file-id-1-photo.png" },
      { options: { upsert: false }, path: "wedding-1/thumbnails/file-id-1-thumb.jpg" },
    ]);

    if (!("uploadIntents" in result.body)) {
      throw new Error("Expected signed upload intents");
    }

    expect(result.body).toMatchObject({
      canUpload: true,
      maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
      requiresReview: true,
      uploadAllowed: true,
    });
    expect(result.body.uploadIntents).toHaveLength(1);
    expect(result.body.uploadIntents[0]).toMatchObject({
      canGenerateThumbnail: true,
      clientId: "file-0",
      mimeType: "image/png",
      sizeBytes: 123,
      thumbnailPath: "wedding-1/thumbnails/file-id-1-thumb.jpg",
      uploadPath: "wedding-1/originals/file-id-1-photo.png",
    });
    expect(result.body.uploadIntents[0]?.signedUploadClaim).toEqual(expect.any(String));
    expect(result.body.uploadIntents[0]?.thumbnailClaim).toEqual(expect.any(String));
  });

  test("skips thumbnail intents for HEIC uploads", async () => {
    const signingAdapter = new FakeSigningAdapter();

    const result = await signHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "heic-client",
            fileName: "photo.heic",
            mimeType: "image/heic",
            sizeBytes: 123,
          },
        ],
      },
      loadHubContext: async () => hubContext(),
      newFileId: () => "file-id-2",
      signingAdapter,
    });

    expect(result.httpStatus).toBe(200);
    expect(signingAdapter.calls).toEqual([
      { options: { upsert: false }, path: "wedding-1/originals/file-id-2-photo.heic" },
    ]);

    if (!("uploadIntents" in result.body)) {
      throw new Error("Expected signed upload intents");
    }

    expect(result.body.uploadIntents[0]).toMatchObject({
      canGenerateThumbnail: false,
      clientId: "heic-client",
      uploadPath: "wedding-1/originals/file-id-2-photo.heic",
    });
    expect(result.body.uploadIntents[0]?.thumbnailPath).toBeUndefined();
  });

  test("maps signing Adapter failure to stable command error", async () => {
    const signingAdapter = new FakeSigningAdapter();
    signingAdapter.failAfterCalls = 0;

    const result = await signHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "client-1",
            fileName: "photo.png",
            mimeType: "image/png",
            sizeBytes: 123,
          },
        ],
      },
      loadHubContext: async () => hubContext(),
      signingAdapter,
    });

    expect(result).toEqual({ body: { error: "failed_to_sign_upload" }, httpStatus: 400 });
  });

  test("maps thumbnail signing Adapter failure to stable command error", async () => {
    const signingAdapter = new FakeSigningAdapter();
    signingAdapter.failAfterCalls = 1;

    const result = await signHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "client-1",
            fileName: "photo.png",
            mimeType: "image/png",
            sizeBytes: 123,
          },
        ],
      },
      loadHubContext: async () => hubContext(),
      newFileId: () => "file-id-3",
      signingAdapter,
    });

    expect(result).toEqual({ body: { error: "failed_to_sign_thumbnail" }, httpStatus: 400 });
    expect(signingAdapter.calls).toEqual([
      { options: { upsert: false }, path: "wedding-1/originals/file-id-3-photo.png" },
      { options: { upsert: false }, path: "wedding-1/thumbnails/file-id-3-thumb.jpg" },
    ]);
  });

  test("rejects invalid finalize payloads before loading Wedding hub access", async () => {
    let contextLoads = 0;
    let finalizeCalls = 0;

    const result = await finalizeHubPhotoUploadsCommand({
      body: { uploads: [null] },
      finalizeUploads: async () => {
        finalizeCalls += 1;
        return [];
      },
      loadHubContext: async () => {
        contextLoads += 1;
        return hubContext();
      },
    });

    expect(result).toEqual({ body: { error: "invalid_payload" }, httpStatus: 400 });
    expect(contextLoads).toBe(0);
    expect(finalizeCalls).toBe(0);
  });

  test("rejects invalid finalize file counts before loading Wedding hub access", async () => {
    let contextLoads = 0;
    let finalizeCalls = 0;

    const result = await finalizeHubPhotoUploadsCommand({
      body: { uploads: [] },
      finalizeUploads: async () => {
        finalizeCalls += 1;
        return [];
      },
      loadHubContext: async () => {
        contextLoads += 1;
        return hubContext();
      },
    });

    expect(result).toEqual({ body: { error: "invalid_file_count" }, httpStatus: 400 });
    expect(contextLoads).toBe(0);
    expect(finalizeCalls).toBe(0);
  });

  test("returns denied finalize body from Wedding hub access", async () => {
    const result = await finalizeHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "client-1",
            originalClaim: "claim",
            originalFileName: "photo.png",
          },
        ],
      },
      finalizeUploads: async () => [successfulFinalizeResult("client-1")],
      loadHubContext: async () => hubContext({ uploadAllowed: false }),
    });

    expect(result).toEqual({
      body: { error: "upload_not_allowed", uploadAllowed: false },
      httpStatus: 403,
    });
  });

  test("finalizes normalized uploads and returns aggregate counts", async () => {
    let seenUploads: unknown;

    const result = await finalizeHubPhotoUploadsCommand({
      body: {
        uploads: [
          {
            clientId: "a".repeat(140),
            note: "n".repeat(MAX_PHOTO_NOTE_LENGTH + 1),
            originalClaim: "claim-1",
            originalFileName: "p".repeat(300),
            thumbnailClaim: 123,
          },
          {
            originalClaim: "claim-2",
            originalFileName: "photo-2.png",
          },
        ],
      },
      createClientId: () => "generated-client",
      finalizeUploads: async ({ uploads }) => {
        seenUploads = uploads;
        return [
          successfulFinalizeResult(uploads[0]?.clientId ?? "missing"),
          failedFinalizeResult(uploads[1]?.clientId ?? "missing"),
        ];
      },
      loadHubContext: async () => hubContext(),
    });

    expect(result.httpStatus).toBe(200);
    expect(seenUploads).toEqual([
      {
        clientId: "a".repeat(128),
        note: "n".repeat(MAX_PHOTO_NOTE_LENGTH),
        originalClaim: "claim-1",
        originalFileName: "p".repeat(255),
        thumbnailClaim: undefined,
      },
      {
        clientId: "generated-client",
        note: undefined,
        originalClaim: "claim-2",
        originalFileName: "photo-2.png",
        thumbnailClaim: undefined,
      },
    ]);

    if (!("results" in result.body)) {
      throw new Error("Expected finalize results");
    }

    expect(result.body.total).toBe(2);
    expect(result.body.succeeded).toBe(1);
    expect(result.body.results).toHaveLength(2);
  });
});
