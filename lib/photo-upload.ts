export const PHOTO_UPLOAD_BUCKET = "wedding-photos";
export const PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const PHOTO_UPLOAD_MAX_THUMBNAIL_SIZE_BYTES = 2 * 1024 * 1024;
export const PHOTO_UPLOAD_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const PHOTO_UPLOAD_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "rejected",
] as const;

export const PHOTO_UPLOAD_THUMBNAIL_STATUSES = ["pending", "ready", "failed", "unavailable"] as const;

export const PHOTO_UPLOAD_MODERATION_STATUSES = [
  "pending",
  "approved",
  "hidden",
] as const;

export type PhotoUploadThumbnailMimeType = (typeof PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES)[number];
export type PhotoUploadThumbnailStatus = (typeof PHOTO_UPLOAD_THUMBNAIL_STATUSES)[number];

export function isPhotoUploadThumbnailMimeType(value: unknown): value is PhotoUploadThumbnailMimeType {
  return (
    typeof value === "string" &&
    PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES.some((mimeType) => mimeType === value)
  );
}

export function isPhotoUploadThumbnailStatus(value: unknown): value is PhotoUploadThumbnailStatus {
  return (
    typeof value === "string" &&
    PHOTO_UPLOAD_THUMBNAIL_STATUSES.some((status) => status === value)
  );
}

export type PhotoUploadMimeType = (typeof PHOTO_UPLOAD_ALLOWED_MIME_TYPES)[number];
export type PhotoUploadVerificationStatus =
  (typeof PHOTO_UPLOAD_VERIFICATION_STATUSES)[number];
export type PhotoUploadModerationStatus =
  (typeof PHOTO_UPLOAD_MODERATION_STATUSES)[number];

export function isPhotoUploadMimeType(value: unknown): value is PhotoUploadMimeType {
  return (
    typeof value === "string" &&
    PHOTO_UPLOAD_ALLOWED_MIME_TYPES.some((mimeType) => mimeType === value)
  );
}

export function isPhotoUploadVerificationStatus(
  value: unknown,
): value is PhotoUploadVerificationStatus {
  return (
    typeof value === "string" &&
    PHOTO_UPLOAD_VERIFICATION_STATUSES.some((status) => status === value)
  );
}

export function isPhotoUploadModerationStatus(
  value: unknown,
): value is PhotoUploadModerationStatus {
  return (
    typeof value === "string" &&
    PHOTO_UPLOAD_MODERATION_STATUSES.some((status) => status === value)
  );
}
