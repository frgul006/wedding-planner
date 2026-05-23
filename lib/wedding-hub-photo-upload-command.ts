import { randomUUID } from "node:crypto";

import { MAX_HUB_FILES_PER_REQUEST, MAX_PHOTO_NOTE_LENGTH } from "@/lib/photo-upload";
import { isRecord } from "@/lib/type-guards";
import type { HubContext } from "@/lib/wedding-hub-access";
import {
  createSignedUploadIntents,
  type HubPhotoUploadSigningAdapter,
  type SignedUploadIntent,
  type UploadFileInput,
} from "@/lib/wedding-hub-photo-upload";
import type {
  FinalizeRequest,
  FinalizeResult,
} from "@/lib/wedding-hub-photo-verification";

type SignRequestUploadPayload = {
  clientId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  note?: unknown;
  sizeBytes?: unknown;
};

export type HubPhotoUploadCommandResult<Body> = {
  body: Body;
  httpStatus: 200 | 400 | 403 | 404;
};

export type HubPhotoUploadErrorBody = {
  error: string;
};

export type SignHubPhotoUploadsDeniedBody = {
  maxFilesPerRequest: number;
  requiresReview: boolean;
  uploadAllowed: false;
  uploadIntents: [];
};

export type SignHubPhotoUploadsSuccessBody = {
  canUpload: true;
  maxFilesPerRequest: number;
  requiresReview: boolean;
  uploadAllowed: true;
  uploadIntents: SignedUploadIntent[];
};

export type SignHubPhotoUploadsCommandBody =
  | HubPhotoUploadErrorBody
  | SignHubPhotoUploadsDeniedBody
  | SignHubPhotoUploadsSuccessBody;

export type FinalizeHubPhotoUploadsDeniedBody = {
  error: "upload_not_allowed";
  uploadAllowed: false;
};

export type FinalizeHubPhotoUploadsSuccessBody = {
  results: FinalizeResult[];
  succeeded: number;
  total: number;
};

export type FinalizeHubPhotoUploadsCommandBody =
  | FinalizeHubPhotoUploadsDeniedBody
  | FinalizeHubPhotoUploadsSuccessBody
  | HubPhotoUploadErrorBody;

export type HubContextLoader = () => Promise<HubContext | null>;

export type FinalizeHubPhotoUploadsAdapter = (input: {
  context: HubContext;
  uploads: FinalizeRequest["uploads"];
}) => Promise<FinalizeResult[]>;

function invalidPayload(): HubPhotoUploadCommandResult<HubPhotoUploadErrorBody> {
  return {
    body: { error: "invalid_payload" },
    httpStatus: 400,
  };
}

function invalidFileCount(): HubPhotoUploadCommandResult<HubPhotoUploadErrorBody> {
  return {
    body: { error: "invalid_file_count" },
    httpStatus: 400,
  };
}

function weddingNotFound(): HubPhotoUploadCommandResult<HubPhotoUploadErrorBody> {
  return {
    body: { error: "wedding_not_found" },
    httpStatus: 404,
  };
}

function parseSignUploads(
  body: unknown,
  createClientId: () => string,
): UploadFileInput[] | null {
  if (!isRecord(body)) {
    return null;
  }

  const rawUploads = body.uploads;
  if (!Array.isArray(rawUploads)) {
    return null;
  }

  const normalized: UploadFileInput[] = [];

  for (const raw of rawUploads) {
    if (!isRecord(raw)) {
      return null;
    }

    const payload: SignRequestUploadPayload = raw;
    const sizeRaw = payload.sizeBytes;
    const normalizedSize = typeof sizeRaw === "number" ? sizeRaw : Number(sizeRaw);

    if (!Number.isFinite(normalizedSize)) {
      return null;
    }

    normalized.push({
      clientId: typeof payload.clientId === "string" ? payload.clientId : createClientId(),
      fileName: typeof payload.fileName === "string" ? payload.fileName : "",
      mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "",
      note: typeof payload.note === "string" ? payload.note : "",
      sizeBytes: Math.trunc(normalizedSize),
    });
  }

  return normalized;
}

function normalizeSignInputs(uploads: UploadFileInput[]) {
  return uploads.map((item, index) => ({
    ...item,
    clientId: item.clientId || `file-${index}`,
    note:
      item.note && item.note.length > MAX_PHOTO_NOTE_LENGTH
        ? item.note.slice(0, MAX_PHOTO_NOTE_LENGTH)
        : item.note,
  }));
}

function parseFinalizeUploads(
  body: unknown,
  createClientId: () => string,
): FinalizeRequest["uploads"] | null {
  if (!isRecord(body)) {
    return null;
  }

  const rawUploads = body.uploads;
  if (!Array.isArray(rawUploads)) {
    return null;
  }

  const normalized: FinalizeRequest["uploads"] = [];

  for (const raw of rawUploads) {
    if (!isRecord(raw)) {
      return null;
    }

    const clientId =
      typeof raw.clientId === "string" && raw.clientId ? raw.clientId : createClientId();

    if (typeof raw.originalClaim !== "string" || typeof raw.originalFileName !== "string") {
      return null;
    }

    normalized.push({
      clientId: clientId.slice(0, 128),
      note:
        typeof raw.note === "string" ? raw.note.slice(0, MAX_PHOTO_NOTE_LENGTH) : undefined,
      originalClaim: raw.originalClaim,
      originalFileName: raw.originalFileName.slice(0, 255),
      thumbnailClaim: typeof raw.thumbnailClaim === "string" ? raw.thumbnailClaim : undefined,
    });
  }

  return normalized;
}

export async function signHubPhotoUploadsCommand({
  body,
  createClientId = randomUUID,
  loadHubContext,
  newFileId,
  signingAdapter,
}: {
  body: unknown;
  createClientId?: () => string;
  loadHubContext: HubContextLoader;
  newFileId?: () => string;
  signingAdapter: HubPhotoUploadSigningAdapter;
}): Promise<HubPhotoUploadCommandResult<SignHubPhotoUploadsCommandBody>> {
  const uploads = parseSignUploads(body, createClientId);

  if (!uploads) {
    return invalidPayload();
  }

  if (!uploads.length || uploads.length > MAX_HUB_FILES_PER_REQUEST) {
    return invalidFileCount();
  }

  const context = await loadHubContext();

  if (!context) {
    return weddingNotFound();
  }

  if (!context.uploadAllowed) {
    return {
      body: {
        maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
        requiresReview: context.wedding.photo_upload_requires_review,
        uploadAllowed: false,
        uploadIntents: [],
      },
      httpStatus: 403,
    };
  }

  try {
    const result = await createSignedUploadIntents({
      inputs: normalizeSignInputs(uploads),
      newFileId,
      signingAdapter,
      wedding: context.wedding,
    });

    return {
      body: {
        canUpload: true,
        maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
        requiresReview: context.wedding.photo_upload_requires_review,
        uploadAllowed: true,
        uploadIntents: result.uploadIntents,
      },
      httpStatus: 200,
    };
  } catch (error) {
    return {
      body: { error: error instanceof Error ? error.message : "unexpected_error" },
      httpStatus: 400,
    };
  }
}

export async function finalizeHubPhotoUploadsCommand({
  body,
  createClientId = randomUUID,
  finalizeUploads,
  loadHubContext,
}: {
  body: unknown;
  createClientId?: () => string;
  finalizeUploads: FinalizeHubPhotoUploadsAdapter;
  loadHubContext: HubContextLoader;
}): Promise<HubPhotoUploadCommandResult<FinalizeHubPhotoUploadsCommandBody>> {
  const uploads = parseFinalizeUploads(body, createClientId);

  if (!uploads) {
    return invalidPayload();
  }

  if (!uploads.length || uploads.length > MAX_HUB_FILES_PER_REQUEST) {
    return invalidFileCount();
  }

  const context = await loadHubContext();

  if (!context) {
    return weddingNotFound();
  }

  if (!context.uploadAllowed) {
    return {
      body: { error: "upload_not_allowed", uploadAllowed: false },
      httpStatus: 403,
    };
  }

  const results = await finalizeUploads({ context, uploads });

  return {
    body: {
      results,
      succeeded: results.filter((row) => row.success).length,
      total: results.length,
    },
    httpStatus: 200,
  };
}
