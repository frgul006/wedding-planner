import crypto from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PHOTO_UPLOAD_ALLOWED_MIME_TYPES,
  PHOTO_UPLOAD_BUCKET,
  PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES,
} from "@/lib/photo-upload";
import { isRecord } from "@/lib/type-guards";

import type { HubWedding } from "./wedding-hub";

export const MAX_HUB_FILES_PER_REQUEST = 8;
export const MAX_PHOTO_NOTE_LENGTH = 512;
export const UPLOAD_CLAIM_TTL_SECONDS = 10 * 60;

const UPLOAD_THUMBNAIL_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const UPLOAD_SIGNING_SECRETS = ["PHOTO_UPLOAD_SIGNING_SECRET", "SUPABASE_SECRET_KEY"] as const;

export type UploadFileInput = {
  clientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note?: string;
};

export type SignedUploadIntent = {
  clientId: string;
  uploadPath: string;
  uploadUrl: string;
  uploadToken: string | null;
  signedUploadClaim: string;
  mimeType: string;
  sizeBytes: number;
  canGenerateThumbnail: boolean;
  thumbnailPath?: string;
  thumbnailUploadUrl?: string;
  thumbnailToken?: string;
  thumbnailClaim?: string;
};

export type SignedHubUploadIntentResponse = {
  uploadIntents: SignedUploadIntent[];
  canUpload: boolean;
  requiresReview: boolean;
  maxFilesPerRequest: number;
};

type UploadClaimType = "original" | "thumbnail";

type UploadClaimPayload = {
  v: 1;
  w: string;
  p: string;
  m: string;
  s: number;
  n: string;
  e: number;
  t: UploadClaimType;
};

type UploadClaimVerification = UploadClaimPayload & {
  valid: true;
};

function getSigningSecret() {
  for (const name of UPLOAD_SIGNING_SECRETS) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  return null;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signClaim(payloadJson: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payloadJson).digest("base64url");
}

function buildUploadClaim(raw: {
  weddingId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  type: "original" | "thumbnail";
}) {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error("Missing upload signing secret");
  }

  const payload: UploadClaimPayload = {
    v: 1,
    w: raw.weddingId,
    p: raw.storagePath,
    m: raw.mimeType,
    s: raw.sizeBytes,
    n: crypto.randomUUID(),
    e: Math.floor((Date.now() + UPLOAD_CLAIM_TTL_SECONDS * 1_000) / 1000),
    t: raw.type,
  };

  const payloadJson = JSON.stringify(payload);
  const data = encodeBase64Url(payloadJson);
  const signature = signClaim(data, secret);

  return `${data}.${signature}`;
}

function isAllowedUploadMime(value: string) {
  return PHOTO_UPLOAD_ALLOWED_MIME_TYPES.some((mime) => mime === value);
}

function cleanFileName(fileName: string) {
  const withoutDirs = fileName.replace(/[/\\]/g, "_");
  const safe = withoutDirs.replace(/[^a-zA-Z0-9._-]/g, "_");
  const shortened = safe.slice(0, 120);

  return shortened.trim() || "photo";
}

export function canGenerateThumbnail(mimeType: string) {
  return UPLOAD_THUMBNAIL_MIME_TYPES.some((mime) => mime === mimeType);
}

export function verifySignedUploadClaim(
  raw: string,
  expectedWeddingId: string,
  expectedType?: UploadClaimType,
): UploadClaimVerification | null {
  const parts = raw.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encoded, signature] = parts;

  if (!encoded || !signature) {
    return null;
  }

  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const expectedSignature = signClaim(encoded, secret);
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature, "base64url"), Buffer.from(expectedSignature, "base64url"))
  ) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeBase64Url(encoded));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const claimType = parsed.t === "thumbnail" || parsed.t === "original" ? parsed.t : null;

  if (
    parsed.v !== 1 ||
    !claimType ||
    (expectedType !== undefined && claimType !== expectedType) ||
    typeof parsed.w !== "string" ||
    parsed.w !== expectedWeddingId ||
    typeof parsed.p !== "string" ||
    typeof parsed.m !== "string" ||
    typeof parsed.s !== "number" ||
    !Number.isFinite(parsed.s) ||
    typeof parsed.n !== "string" ||
    typeof parsed.e !== "number" ||
    !Number.isFinite(parsed.e) ||
    (claimType === "original" && parsed.s <= 0) ||
    (claimType === "thumbnail" && parsed.s < 0) ||
    parsed.e <= Math.floor(Date.now() / 1000) ||
    !isAllowedUploadMime(parsed.m)
  ) {
    return null;
  }

  return {
    v: 1,
    w: parsed.w,
    p: parsed.p,
    m: parsed.m,
    s: parsed.s,
    n: parsed.n,
    e: parsed.e,
    t: claimType,
    valid: true,
  };
}

export async function createSignedUploadIntents({
  inputs,
  wedding,
  supabase,
}: {
  inputs: UploadFileInput[];
  wedding: HubWedding;
  supabase: SupabaseClient;
}): Promise<SignedHubUploadIntentResponse> {
  if (!inputs.length || inputs.length > MAX_HUB_FILES_PER_REQUEST) {
    throw new Error("invalid_file_count");
  }

  const intents: SignedUploadIntent[] = [];

  for (const input of inputs) {
    const safeFileName = cleanFileName(input.fileName);

    if (
      !input.clientId ||
      input.clientId.length > 128 ||
      typeof input.fileName !== "string" ||
      !input.fileName.trim()
    ) {
      throw new Error("invalid_client_payload");
    }

    if (!isAllowedUploadMime(input.mimeType)) {
      throw new Error("unsupported_mime");
    }

    if (
      !Number.isFinite(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES
    ) {
      throw new Error("invalid_file_size");
    }

    if ((input.note ?? "").length > MAX_PHOTO_NOTE_LENGTH) {
      throw new Error("invalid_note_length");
    }

    const fileId = crypto.randomUUID();
    const originalPath = `${wedding.id}/originals/${fileId}-${safeFileName}`;

    const originalSigned = await supabase.storage
      .from(PHOTO_UPLOAD_BUCKET)
      .createSignedUploadUrl(originalPath, { upsert: false });

    if (originalSigned.error || !originalSigned.data) {
      throw new Error("failed_to_sign_upload");
    }

    const includeThumbnail = canGenerateThumbnail(input.mimeType);
    const intent: SignedUploadIntent = {
      clientId: input.clientId,
      uploadPath: originalPath,
      uploadUrl: originalSigned.data.signedUrl,
      uploadToken: originalSigned.data.token,
      signedUploadClaim: buildUploadClaim({
        weddingId: wedding.id,
        storagePath: originalPath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        type: "original",
      }),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      canGenerateThumbnail: includeThumbnail,
    };

    if (includeThumbnail) {
      const thumbFile = `${fileId}-thumb.jpg`;
      const thumbnailPath = `${wedding.id}/thumbnails/${thumbFile}`;
      const thumbnailSigned = await supabase.storage
        .from(PHOTO_UPLOAD_BUCKET)
        .createSignedUploadUrl(thumbnailPath, { upsert: false });

      if (thumbnailSigned.error || !thumbnailSigned.data) {
        throw new Error("failed_to_sign_thumbnail");
      }

      intent.thumbnailPath = thumbnailPath;
      intent.thumbnailUploadUrl = thumbnailSigned.data.signedUrl;
      intent.thumbnailToken = thumbnailSigned.data.token;
      intent.thumbnailClaim = buildUploadClaim({
        weddingId: wedding.id,
        storagePath: thumbnailPath,
        mimeType: "image/jpeg",
        sizeBytes: 0,
        type: "thumbnail",
      });
    }

    intents.push(intent);
  }

  return {
    uploadIntents: intents,
    canUpload: true,
    requiresReview: wedding.photo_upload_requires_review,
    maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
  };
}

export function signedClaimStoragePath(claim: UploadClaimVerification) {
  return claim.p;
}

export type { UploadClaimPayload };
