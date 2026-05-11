import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PHOTO_UPLOAD_ALLOWED_MIME_TYPES,
  PHOTO_UPLOAD_BUCKET,
  PHOTO_UPLOAD_MAX_THUMBNAIL_SIZE_BYTES,
  PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES,
} from "@/lib/photo-upload";
import { isRecord } from "@/lib/type-guards";
import { verifySignedUploadClaim } from "@/lib/wedding-hub-photo-upload";
import type { HubUploadAttribution } from "@/lib/wedding-hub-photo";
import type { HubWedding } from "@/lib/wedding-hub";

export type FinalizeRequestItem = {
  clientId: string;
  originalClaim: string;
  originalFileName: string;
  note?: string;
  thumbnailClaim?: string;
};

export type FinalizeRequest = {
  uploads: FinalizeRequestItem[];
};

export type FinalizeResult = {
  clientId: string;
  success: boolean;
  photoId: string | null;
  status: "verified" | "rejected" | "error";
  reason: string | null;
  photoStoragePath: string;
  thumbnailStatus: string;
};

export type HubFeedItem = {
  id: string;
  when: string;
  who: string;
  caption: string | null;
  photoUrl: string;
  thumbnailUrl: string;
};

export type HubGalleryPhoto = {
  id: string;
  uploadedAt: string;
  who: string;
  note: string | null;
  photoUrl: string;
  thumbnailUrl: string;
};

export type HubPhotoData = {
  photos: {
    totalPhotoCount: number;
    photos: HubGalleryPhoto[];
  };
  feed: HubFeedItem[];
};

type HeaderVerifyResult = {
  ok: boolean;
  reason: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

type ThumbnailFinalizeUpdate = {
  thumbnail_status: "pending" | "ready" | "failed" | "unavailable";
  thumbnail_storage_path: string | null;
  thumbnail_mime_type: string | null;
  thumbnail_size_bytes: number | null;
  thumbnail_verified_at: string | null;
  thumbnail_error: string | null;
};

type HubPhotoRow = {
  id: string;
  storage_path: string;
  note: string | null;
  created_at: string;
  thumbnail_status: string | null;
  thumbnail_storage_path: string | null;
  guests: unknown;
};

const VERIFY_HEADER_BYTES = 8192;

function toGalleryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeStyle: "short",
    hour12: false,
  }).format(date);
}

function isHubPhotoRow(value: unknown): value is HubPhotoRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.storage_path === "string" &&
    (value.note === null || typeof value.note === "string") &&
    typeof value.created_at === "string" &&
    (value.thumbnail_status === null || typeof value.thumbnail_status === "string") &&
    (value.thumbnail_storage_path === null || typeof value.thumbnail_storage_path === "string")
  );
}

function normalizeGuestName(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return normalizeGuestName(value[0]);
  }

  if (isRecord(value) && typeof value.full_name === "string") {
    return value.full_name;
  }

  return null;
}

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brands = String.fromCharCode(...bytes.slice(8, Math.min(bytes.length, 64))).toLowerCase();

    if (brands.includes("mif1") || brands.includes("msf1") || brands.includes("heif")) {
      return "image/heif";
    }

    if (
      brands.includes("heic") ||
      brands.includes("heix") ||
      brands.includes("hevc") ||
      brands.includes("hevx")
    ) {
      return "image/heic";
    }
  }

  return null;
}

async function readSignedObjectHeader(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage
    .from(PHOTO_UPLOAD_BUCKET)
    .createSignedUrl(path, 120);

  if (error || !data?.signedUrl) {
    return null;
  }

  const response = await fetch(data.signedUrl, { method: "GET" });

  if (!response.ok || !response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (received < VERIFY_HEADER_BYTES) {
      const readResult = await reader.read();
      if (readResult.done) {
        break;
      }

      const remaining = VERIFY_HEADER_BYTES - received;
      const chunk = readResult.value.slice(0, remaining);
      chunks.push(chunk);
      received += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes };
}

async function verifyStoredObject({
  supabase,
  path,
  declaredSize,
  declaredMime,
  skipSizeCheck,
  maxSizeBytes,
  allowedMimeTypes,
}: {
  supabase: SupabaseClient;
  path: string;
  declaredSize: number;
  declaredMime: string;
  skipSizeCheck?: boolean;
  maxSizeBytes?: number;
  allowedMimeTypes?: readonly string[];
}) {
  const infoResult = await supabase.storage.from(PHOTO_UPLOAD_BUCKET).info(path);

  if (infoResult.error || !infoResult.data || typeof infoResult.data.size !== "number") {
    return {
      ok: false,
      reason: "object_missing",
      mimeType: null,
      sizeBytes: null,
    } satisfies HeaderVerifyResult;
  }

  if (
    !skipSizeCheck &&
    (infoResult.data.size <= 0 ||
      infoResult.data.size > declaredSize + 16 ||
      infoResult.data.size < declaredSize - 16)
  ) {
    return {
      ok: false,
      reason: "size_mismatch",
      mimeType: null,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  if (infoResult.data.size <= 0) {
    return {
      ok: false,
      reason: "invalid_size",
      mimeType: null,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  if (maxSizeBytes !== undefined && infoResult.data.size > maxSizeBytes) {
    return {
      ok: false,
      reason: "size_too_large",
      mimeType: null,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  const headerResult = await readSignedObjectHeader(supabase, path);

  if (!headerResult) {
    return {
      ok: false,
      reason: "header_fetch_failed",
      mimeType: null,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  const detected = detectMime(headerResult.bytes);

  if (!detected) {
    return {
      ok: false,
      reason: "invalid_magic",
      mimeType: null,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  const acceptedMimeTypes = allowedMimeTypes ?? PHOTO_UPLOAD_ALLOWED_MIME_TYPES;
  const isAllowedMime = acceptedMimeTypes.some((mimeType) => mimeType === detected);

  if (!isAllowedMime) {
    return {
      ok: false,
      reason: "mime_not_allowed",
      mimeType: detected,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  if (declaredMime && declaredMime !== detected) {
    return {
      ok: false,
      reason: "mime_mismatch",
      mimeType: detected,
      sizeBytes: infoResult.data.size,
    } satisfies HeaderVerifyResult;
  }

  return {
    ok: true,
    reason: null,
    mimeType: detected,
    sizeBytes: infoResult.data.size,
  } satisfies HeaderVerifyResult;
}

async function signStoragePath(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage
    .from(PHOTO_UPLOAD_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    return "";
  }

  return data.signedUrl;
}

async function signForGalleryRow(supabase: SupabaseClient, row: {
  storage_path: string;
  thumbnail_storage_path: string | null;
  thumbnail_status: string | null;
}) {
  const photoUrl = await signStoragePath(supabase, row.storage_path);

  if (row.thumbnail_status === "ready" && row.thumbnail_storage_path) {
    const thumb = await signStoragePath(supabase, row.thumbnail_storage_path);
    if (thumb) {
      return { photoUrl, thumbnailUrl: thumb };
    }
  }

  return { photoUrl, thumbnailUrl: photoUrl };
}

export async function finalizePhotoUploads({
  supabase,
  wedding,
  attribution,
  items,
}: {
  supabase: SupabaseClient;
  wedding: HubWedding;
  attribution: HubUploadAttribution;
  items: FinalizeRequest["uploads"];
}): Promise<FinalizeResult[]> {
  const results: FinalizeResult[] = [];

  for (const item of items) {
    const resultBase = {
      clientId: item.clientId,
      photoStoragePath: "",
      thumbnailStatus: "unavailable",
    };

    const originalClaim = verifySignedUploadClaim(item.originalClaim, wedding.id, "original");

    if (!originalClaim) {
      results.push({
        ...resultBase,
        success: false,
        photoId: null,
        status: "error",
        reason: "invalid_claim",
        thumbnailStatus: "unavailable",
      });
      continue;
    }

    const path = originalClaim.p;
    const moderationStatus = wedding.photo_upload_requires_review ? "pending" : "approved";

    const guestId = attribution.guestNavigationSession?.guestId ?? null;
    const sessionId = attribution.guestNavigationSession?.id ?? null;

    const now = new Date().toISOString();

    const existing = await supabase
      .from("photo_uploads")
      .select("id, verification_status, thumbnail_status")
      .eq("wedding_id", wedding.id)
      .eq("storage_path", path)
      .maybeSingle();

    if (existing.error) {
      console.error("Failed to read existing upload", existing.error);
      results.push({
        ...resultBase,
        clientId: item.clientId,
        photoStoragePath: path,
        success: false,
        photoId: null,
        status: "error",
        reason: "existing_lookup_failed",
        thumbnailStatus: "unavailable",
      });
      continue;
    }

    if (existing.data && existing.data.verification_status === "verified") {
      results.push({
        ...resultBase,
        clientId: item.clientId,
        photoStoragePath: path,
        success: true,
        photoId: existing.data.id,
        status: "verified",
        reason: null,
        thumbnailStatus: existing.data.thumbnail_status ?? "unavailable",
      });
      continue;
    }

    const existingId = existing.data?.id ?? null;

    if (!existingId) {
      const thumbnailClaim = item.thumbnailClaim
        ? verifySignedUploadClaim(item.thumbnailClaim, wedding.id, "thumbnail")
        : null;

      const thumbnailStatus = thumbnailClaim
        ? "pending"
        : "unavailable";

      const inserted = await supabase
        .from("photo_uploads")
        .insert({
          wedding_id: wedding.id,
          session_id: sessionId,
          guest_id: guestId,
          storage_path: path,
          original_filename: item.originalFileName,
          mime_type: originalClaim.m,
          size_bytes: originalClaim.s,
          note: item.note?.trim() || null,
          verification_status: "pending",
          moderation_status: moderationStatus,
          thumbnail_status: thumbnailStatus,
          thumbnail_storage_path: thumbnailClaim ? thumbnailClaim.p : null,
        })
        .select("id")
        .single();

      if (inserted.error || !inserted.data?.id) {
        console.error("Failed to insert photo upload row", inserted.error);
        results.push({
          ...resultBase,
          clientId: item.clientId,
          photoStoragePath: path,
          success: false,
          photoId: null,
          status: "error",
          reason: "insert_failed",
          thumbnailStatus,
        });
        continue;
      }

      if (inserted.data.id) {
        const updateResult = await verifyAndFinalizePhoto({
          supabase,
          wedding,
          claim: originalClaim,
          clientId: item.clientId,
          fileName: item.originalFileName,
          guestId,
          sessionId,
          note: item.note?.trim() || null,
          thumbnailClaim: item.thumbnailClaim,
          now,
          photoUploadId: inserted.data.id,
        });

        results.push(updateResult);
      }
      continue;
    }

    const update = await verifyAndFinalizePhoto({
      supabase,
      wedding,
      claim: originalClaim,
      clientId: item.clientId,
      fileName: item.originalFileName,
      guestId,
      sessionId,
      note: item.note?.trim() || null,
      thumbnailClaim: item.thumbnailClaim,
      now,
      photoUploadId: existingId,
    });
    results.push(update);
  }

  return results;
}

async function verifyAndFinalizePhoto({
  supabase,
  wedding,
  claim,
  clientId,
  fileName,
  guestId,
  sessionId,
  note,
  thumbnailClaim,
  now,
  photoUploadId,
}: {
  supabase: SupabaseClient;
  wedding: HubWedding;
  claim: NonNullable<ReturnType<typeof verifySignedUploadClaim>>;
  clientId: string;
  fileName: string;
  guestId: string | null;
  sessionId: string | null;
  note: string | null;
  thumbnailClaim?: string;
  now: string;
  photoUploadId: string;
}): Promise<FinalizeResult> {
  const verified = await verifyStoredObject({
    supabase,
    path: claim.p,
    declaredMime: claim.m,
    declaredSize: claim.s,
  });

  if (!verified.ok) {
    const rejected = await supabase
      .from("photo_uploads")
      .update({
        verification_status: "rejected",
        verification_error: verified.reason,
        rejected_at: now,
        verified_at: null,
        note,
        original_filename: fileName,
        session_id: sessionId,
        guest_id: guestId,
        mime_type: verified.mimeType,
        size_bytes: verified.sizeBytes,
        thumbnail_status: "unavailable",
        thumbnail_storage_path: null,
        thumbnail_mime_type: null,
        thumbnail_size_bytes: null,
        thumbnail_verified_at: null,
        thumbnail_error: null,
      })
      .eq("id", photoUploadId)
      .eq("wedding_id", wedding.id);

    if (rejected.error) {
      console.error("Failed to reject upload", rejected.error);
    }

    await purgeUploadedObject(supabase, claim.p);

    if (thumbnailClaim) {
      const parsedThumbnail = verifySignedUploadClaim(thumbnailClaim, wedding.id, "thumbnail");
      if (parsedThumbnail) {
        await purgeUploadedObject(supabase, parsedThumbnail.p);
      }
    }

    return {
      clientId,
      success: false,
      photoId: photoUploadId,
      status: "rejected",
      reason: verified.reason,
      photoStoragePath: claim.p,
      thumbnailStatus: "unavailable",
    };
  }

  const thumbnailStatus = await finalizeThumbnail({
    supabase,
    weddingId: wedding.id,
    thumbnailClaim,
  });

  const updated = await supabase
    .from("photo_uploads")
    .update({
      verification_status: "verified",
      verified_at: now,
      rejected_at: null,
      verification_error: null,
      original_filename: fileName,
      mime_type: verified.mimeType,
      size_bytes: verified.sizeBytes,
      note,
      guest_id: guestId,
      session_id: sessionId,
      ...thumbnailStatus,
    })
    .eq("id", photoUploadId)
    .eq("wedding_id", wedding.id)
    .select("id")
    .single();

  if (updated.error || !updated.data) {
    console.error("Failed to persist verification result", updated.error);
    return {
      clientId,
      success: false,
      photoId: photoUploadId,
      status: "error",
      reason: "finalize_update_failed",
      photoStoragePath: claim.p,
      thumbnailStatus: thumbnailStatus.thumbnail_status,
    };
  }

  return {
    clientId,
    success: true,
    photoId: updated.data.id,
    status: "verified",
    reason: null,
    photoStoragePath: claim.p,
    thumbnailStatus: thumbnailStatus.thumbnail_status,
  };
}

async function finalizeThumbnail({
  supabase,
  weddingId,
  thumbnailClaim,
}: {
  supabase: SupabaseClient;
  weddingId: string;
  thumbnailClaim?: string;
}): Promise<ThumbnailFinalizeUpdate> {
  if (!thumbnailClaim) {
    return {
      thumbnail_status: "unavailable",
      thumbnail_storage_path: null,
      thumbnail_mime_type: null,
      thumbnail_size_bytes: null,
      thumbnail_verified_at: null,
      thumbnail_error: null,
    };
  }

  const parsed = verifySignedUploadClaim(thumbnailClaim, weddingId, "thumbnail");

  if (!parsed) {
    return {
      thumbnail_status: "failed",
      thumbnail_storage_path: null,
      thumbnail_mime_type: null,
      thumbnail_size_bytes: null,
      thumbnail_verified_at: null,
      thumbnail_error: "invalid_thumbnail_claim",
    };
  }

  const verified = await verifyStoredObject({
    supabase,
    path: parsed.p,
    declaredMime: parsed.m,
    declaredSize: Math.max(parsed.s, 1),
    skipSizeCheck: true,
    maxSizeBytes: PHOTO_UPLOAD_MAX_THUMBNAIL_SIZE_BYTES,
    allowedMimeTypes: PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES,
  });

  if (!verified.ok) {
    await purgeUploadedObject(supabase, parsed.p);

    return {
      thumbnail_status: "failed",
      thumbnail_storage_path: null,
      thumbnail_mime_type: null,
      thumbnail_size_bytes: null,
      thumbnail_verified_at: null,
      thumbnail_error: verified.reason,
    };
  }

  return {
    thumbnail_status: "ready",
    thumbnail_storage_path: parsed.p,
    thumbnail_mime_type: verified.mimeType,
    thumbnail_size_bytes: verified.sizeBytes,
    thumbnail_verified_at: new Date().toISOString(),
    thumbnail_error: null,
  };
}

async function purgeUploadedObject(supabase: SupabaseClient, path: string) {
  const { error } = await supabase.storage.from(PHOTO_UPLOAD_BUCKET).remove([path]);
  if (error) {
    console.error("Failed to remove rejected object", error);
  }
}

export async function getWeddingHubPhotoData({
  supabase,
  wedding,
}: {
  supabase: SupabaseClient;
  wedding: HubWedding;
}): Promise<HubPhotoData> {
  const fallback: HubPhotoData = {
    photos: {
      totalPhotoCount: 0,
      photos: [],
    },
    feed: [],
  };

  const [photosResult, countResult] = await Promise.all([
    supabase
      .from("photo_uploads")
      .select(
        "id, storage_path, note, created_at, thumbnail_status, thumbnail_storage_path, guests(full_name)",
      )
      .eq("wedding_id", wedding.id)
      .eq("verification_status", "verified")
      .eq("moderation_status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("photo_uploads")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", wedding.id)
      .eq("verification_status", "verified")
      .eq("moderation_status", "approved")
      .is("deleted_at", null),
  ]);

  if (photosResult.error || !photosResult.data) {
    console.error("Failed to load hub photo feed", photosResult.error);
    return fallback;
  }

  const rows = Array.isArray(photosResult.data)
    ? photosResult.data.filter(isHubPhotoRow)
    : [];

  const photos: HubGalleryPhoto[] = [];
  const feed: HubFeedItem[] = [];

  for (const row of rows) {
    const rowSigned = await signForGalleryRow(supabase, row);

    const who = normalizeGuestName(row.guests) ?? "Gäst";
    const isSignedPhoto = rowSigned.photoUrl.length > 0;

    if (!isSignedPhoto) {
      continue;
    }

    photos.push({
      id: row.id,
      uploadedAt: row.created_at,
      who,
      note: row.note,
      photoUrl: rowSigned.photoUrl,
      thumbnailUrl: rowSigned.thumbnailUrl,
    });

    feed.push({
      id: row.id,
      when: toGalleryTime(row.created_at),
      who,
      caption: row.note,
      photoUrl: rowSigned.photoUrl,
      thumbnailUrl: rowSigned.thumbnailUrl,
    });
  }

  return {
    photos: {
      totalPhotoCount: countResult.count ?? rows.length,
      photos,
    },
    feed,
  };
}
