"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { PHOTO_UPLOAD_BUCKET } from "@/lib/photo-upload";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isRecord } from "@/lib/type-guards";

const allowedFilters = new Set([
  "all",
  "pending",
  "approved",
  "hidden",
  "rejected",
  "verifying",
  "deleted",
]);

type ModerationStatus = "approved" | "hidden" | "deleted";
type ModerationError = "not-found" | "not-verified" | "update-failed";

type PhotoModerationRow = {
  id: string;
  storage_path: string;
  thumbnail_storage_path: string | null;
  verification_status: string;
  deleted_at: string | null;
};

function photosRedirectUrl({
  error,
  filter,
  status,
}: {
  error?: ModerationError;
  filter?: string;
  status?: ModerationStatus;
}) {
  const params = new URLSearchParams();
  const safeFilter = filter && allowedFilters.has(filter) ? filter : "all";

  if (safeFilter !== "all") {
    params.set("filter", safeFilter);
  }

  if (status) {
    params.set("status", status);
  }

  if (error) {
    params.set("error", error);
  }

  const query = params.toString();
  return query ? `/admin/photos?${query}` : "/admin/photos";
}

function revalidatePhotoPaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/photos");
  revalidatePath("/wedding-hub");
  revalidatePath("/api/wedding-hub/photos");
}

function isPhotoModerationRow(value: unknown): value is PhotoModerationRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.storage_path === "string" &&
    (value.thumbnail_storage_path === null || typeof value.thumbnail_storage_path === "string") &&
    typeof value.verification_status === "string" &&
    (value.deleted_at === null || typeof value.deleted_at === "string")
  );
}

async function getModerationRow(photoId: string, weddingId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("photo_uploads")
    .select("id, storage_path, thumbnail_storage_path, verification_status, deleted_at")
    .eq("id", photoId)
    .eq("wedding_id", weddingId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load photo upload", error);
    return { error: "update-failed" as const, row: null, supabase };
  }

  if (!isPhotoModerationRow(data)) {
    return { error: "not-found" as const, row: null, supabase };
  }

  return { error: null, row: data, supabase };
}

export async function approvePhotoUploadAction(photoId: string, currentFilter?: string) {
  const adminProfile = await requireActiveAdminProfile();
  const { error: rowError, row, supabase } = await getModerationRow(
    photoId,
    adminProfile.wedding_id,
  );

  if (rowError || !row || row.deleted_at) {
    redirect(photosRedirectUrl({ error: rowError ?? "not-found", filter: currentFilter }));
  }

  if (row.verification_status !== "verified") {
    redirect(photosRedirectUrl({ error: "not-verified", filter: currentFilter }));
  }

  const { data, error } = await supabase
    .from("photo_uploads")
    .update({ moderation_status: "approved" })
    .eq("id", photoId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .eq("verification_status", "verified")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to approve photo upload", error);
    redirect(photosRedirectUrl({ error: "update-failed", filter: currentFilter }));
  }

  if (!data) {
    redirect(photosRedirectUrl({ error: "not-found", filter: currentFilter }));
  }

  revalidatePhotoPaths();
  redirect(photosRedirectUrl({ filter: currentFilter, status: "approved" }));
}

export async function hidePhotoUploadAction(photoId: string, currentFilter?: string) {
  const adminProfile = await requireActiveAdminProfile();
  const { error: rowError, row, supabase } = await getModerationRow(
    photoId,
    adminProfile.wedding_id,
  );

  if (rowError || !row || row.deleted_at) {
    redirect(photosRedirectUrl({ error: rowError ?? "not-found", filter: currentFilter }));
  }

  const { data, error } = await supabase
    .from("photo_uploads")
    .update({ moderation_status: "hidden" })
    .eq("id", photoId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to hide photo upload", error);
    redirect(photosRedirectUrl({ error: "update-failed", filter: currentFilter }));
  }

  if (!data) {
    redirect(photosRedirectUrl({ error: "not-found", filter: currentFilter }));
  }

  revalidatePhotoPaths();
  redirect(photosRedirectUrl({ filter: currentFilter, status: "hidden" }));
}

export async function deletePhotoUploadAction(photoId: string, currentFilter?: string) {
  const adminProfile = await requireActiveAdminProfile();
  const { error: rowError, row, supabase } = await getModerationRow(
    photoId,
    adminProfile.wedding_id,
  );

  if (rowError || !row || row.deleted_at) {
    redirect(photosRedirectUrl({ error: rowError ?? "not-found", filter: currentFilter }));
  }

  const deletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("photo_uploads")
    .update({
      deleted_at: deletedAt,
      moderation_status: "hidden",
    })
    .eq("id", photoId)
    .eq("wedding_id", adminProfile.wedding_id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to tombstone photo upload", error);
    redirect(photosRedirectUrl({ error: "update-failed", filter: currentFilter }));
  }

  if (!data) {
    redirect(photosRedirectUrl({ error: "not-found", filter: currentFilter }));
  }

  const storagePaths = [row.storage_path, row.thumbnail_storage_path].filter(
    (path): path is string => Boolean(path),
  );

  if (storagePaths.length > 0) {
    const removeResult = await supabase.storage.from(PHOTO_UPLOAD_BUCKET).remove(storagePaths);

    if (removeResult.error) {
      console.error("Failed to remove deleted photo storage objects", removeResult.error);
    }
  }

  revalidatePhotoPaths();
  redirect(photosRedirectUrl({ filter: currentFilter, status: "deleted" }));
}
