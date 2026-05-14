import { isRecord } from "@/lib/type-guards";

export function normalizePhotoGuestName(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return normalizePhotoGuestName(value[0]);
  }

  if (isRecord(value) && typeof value.full_name === "string") {
    return value.full_name;
  }

  return null;
}
