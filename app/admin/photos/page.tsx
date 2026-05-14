/* eslint-disable @next/next/no-img-element -- Admin previews use short-lived signed Supabase URLs. */

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  ACCEPTED_PHOTO_UPLOAD_FILTER,
  PHOTO_UPLOAD_BUCKET,
  isAcceptedPhotoUpload,
  isPhotoUploadModerationStatus,
  isPhotoUploadVerificationStatus,
  type PhotoUploadModerationStatus,
  type PhotoUploadVerificationStatus,
} from "@/lib/photo-upload";
import { normalizePhotoGuestName } from "@/lib/photo-upload-display";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isNullableString, isRecord } from "@/lib/type-guards";

import { PhotoListRefresh } from "./photo-list-refresh";
import { PhotoModerationActions } from "./photo-moderation-actions";

export const metadata: Metadata = {
  title: "Photos | Wedding Planner",
};

type PhotosPageProps = {
  searchParams: Promise<{
    error?: string | string[];
    filter?: string | string[];
    page?: string | string[];
    status?: string | string[];
  }>;
};

type PhotoFilter =
  | "all"
  | "pending"
  | "approved"
  | "hidden"
  | "rejected"
  | "verifying"
  | "deleted";

type PhotoUploadRow = {
  id: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  verification_status: PhotoUploadVerificationStatus;
  verified_at: string | null;
  rejected_at: string | null;
  verification_error: string | null;
  moderation_status: PhotoUploadModerationStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  thumbnail_status: string | null;
  thumbnail_storage_path: string | null;
  thumbnail_error: string | null;
  guests: unknown;
};

type SignedPhotoUpload = PhotoUploadRow & {
  guestName: string | null;
  originalUrl: string | null;
  previewUrl: string | null;
};

const FILTERS: Array<{ label: string; value: PhotoFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending review", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Hidden", value: "hidden" },
  { label: "Rejected", value: "rejected" },
  { label: "Verifying", value: "verifying" },
  { label: "Deleted", value: "deleted" },
];

const uploadedAtFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});
const signedUrlExpiresInSeconds = 15 * 60;
const photosPageSize = 50;

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isPhotoFilter(value: unknown): value is PhotoFilter {
  return typeof value === "string" && FILTERS.some((filter) => filter.value === value);
}

function getFilter(value: string | string[] | undefined): PhotoFilter {
  const raw = getFirstParam(value);
  return isPhotoFilter(raw) ? raw : "all";
}

function getPage(value: string | string[] | undefined) {
  const raw = getFirstParam(value);
  const page = Number(raw);

  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }

  return page;
}

function getPhotosHref(filter: PhotoFilter, page: number) {
  const params = new URLSearchParams();

  if (filter !== "all") {
    params.set("filter", filter);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `/admin/photos?${query}` : "/admin/photos";
}

function getMessage(searchParams: Awaited<PhotosPageProps["searchParams"]>) {
  const error = getFirstParam(searchParams.error);
  const status = getFirstParam(searchParams.status);

  if (error === "not-found") {
    return { tone: "error", text: "Photo was not found for this wedding." };
  }

  if (error === "not-verified") {
    return { tone: "error", text: "Only verified photos can be approved." };
  }

  if (error) {
    return { tone: "error", text: "Could not update the photo. Please try again." };
  }

  if (status === "approved") {
    return { tone: "success", text: "Photo approved." };
  }

  if (status === "hidden") {
    return { tone: "success", text: "Photo hidden from public gallery and export." };
  }

  if (status === "deleted") {
    return { tone: "success", text: "Photo deleted and removed from public gallery/export." };
  }

  return null;
}

function isPhotoUploadRow(value: unknown): value is PhotoUploadRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.storage_path === "string" &&
    isNullableString(value.original_filename) &&
    isNullableString(value.mime_type) &&
    (value.size_bytes === null || typeof value.size_bytes === "number") &&
    isNullableString(value.note) &&
    isPhotoUploadVerificationStatus(value.verification_status) &&
    isNullableString(value.verified_at) &&
    isNullableString(value.rejected_at) &&
    isNullableString(value.verification_error) &&
    isPhotoUploadModerationStatus(value.moderation_status) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    isNullableString(value.deleted_at) &&
    isNullableString(value.thumbnail_status) &&
    isNullableString(value.thumbnail_storage_path) &&
    isNullableString(value.thumbnail_error)
  );
}

function formatUploadedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return uploadedAtFormatter.format(date);
}

function formatBytes(value: number | null) {
  if (!value || value < 1) {
    return "Unknown size";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.round(value / 1024)} KB`;
}

function readableFileName(row: PhotoUploadRow) {
  return row.original_filename || row.storage_path.split("/").at(-1) || "photo";
}

function getVerificationPill(status: PhotoUploadVerificationStatus) {
  if (status === "verified") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  if (status === "rejected") {
    return "bg-red-50 text-red-700 ring-red-100";
  }

  return "bg-amber-50 text-amber-700 ring-amber-100";
}

function getModerationPill(status: PhotoUploadModerationStatus, deletedAt: string | null) {
  if (deletedAt) {
    return "bg-zinc-100 text-zinc-600 ring-zinc-200";
  }

  if (status === "approved") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  if (status === "hidden") {
    return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }

  return "bg-sky-50 text-sky-700 ring-sky-100";
}

function getModerationLabel(status: PhotoUploadModerationStatus, deletedAt: string | null) {
  if (deletedAt) {
    return "deleted";
  }

  if (status === "pending") {
    return "pending review";
  }

  return status;
}

function getPublicState(row: PhotoUploadRow) {
  return isAcceptedPhotoUpload(row) ? "Public/exportable" : "Excluded from public/export";
}

function getPreviewPath(row: PhotoUploadRow) {
  return row.thumbnail_status === "ready" && row.thumbnail_storage_path
    ? row.thumbnail_storage_path
    : row.storage_path;
}

async function signPhotos(
  supabase: SupabaseClient,
  rows: PhotoUploadRow[],
): Promise<SignedPhotoUpload[]> {
  const pathsToSign = Array.from(
    new Set(
      rows.flatMap((row) => {
        if (row.deleted_at) {
          return [];
        }

        return [getPreviewPath(row), row.storage_path];
      }),
    ),
  );
  const signedByPath = new Map<string, string>();

  if (pathsToSign.length > 0) {
    const { data, error } = await supabase.storage
      .from(PHOTO_UPLOAD_BUCKET)
      .createSignedUrls(pathsToSign, signedUrlExpiresInSeconds);

    if (error) {
      console.error("Failed to sign admin photo previews", error);
    }

    for (const signed of data ?? []) {
      if (signed.path && signed.signedUrl) {
        signedByPath.set(signed.path, signed.signedUrl);
      }
    }
  }

  return rows.map((row) => {
    if (row.deleted_at) {
      return {
        ...row,
        guestName: normalizePhotoGuestName(row.guests),
        originalUrl: null,
        previewUrl: null,
      };
    }

    return {
      ...row,
      guestName: normalizePhotoGuestName(row.guests),
      originalUrl: signedByPath.get(row.storage_path) ?? null,
      previewUrl: signedByPath.get(getPreviewPath(row)) ?? null,
    };
  });
}

export default async function PhotosPage({ searchParams }: PhotosPageProps) {
  await connection();

  const params = await searchParams;
  const filter = getFilter(params.filter);
  const requestedPage = getPage(params.page);
  const message = getMessage(params);
  const adminProfile = await requireActiveAdminProfile();
  const supabase = createSupabaseAdminClient();
  let countQuery = supabase
    .from("photo_uploads")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", adminProfile.wedding_id);

  if (filter === "approved") {
    countQuery = countQuery
      .eq("verification_status", ACCEPTED_PHOTO_UPLOAD_FILTER.verification_status)
      .eq("moderation_status", ACCEPTED_PHOTO_UPLOAD_FILTER.moderation_status)
      .is("deleted_at", ACCEPTED_PHOTO_UPLOAD_FILTER.deleted_at);
  } else if (filter === "pending") {
    countQuery = countQuery
      .eq("verification_status", "verified")
      .eq("moderation_status", "pending")
      .is("deleted_at", null);
  } else if (filter === "hidden") {
    countQuery = countQuery.eq("moderation_status", "hidden").is("deleted_at", null);
  } else if (filter === "rejected") {
    countQuery = countQuery.eq("verification_status", "rejected").is("deleted_at", null);
  } else if (filter === "verifying") {
    countQuery = countQuery.eq("verification_status", "pending").is("deleted_at", null);
  } else if (filter === "deleted") {
    countQuery = countQuery.not("deleted_at", "is", null);
  }

  const { count, error: countError } = await countQuery;
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / photosPageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * photosPageSize;
  const pageEnd = pageStart + photosPageSize - 1;
  let photoQuery = supabase
    .from("photo_uploads")
    .select(
      "id, storage_path, original_filename, mime_type, size_bytes, note, verification_status, verified_at, rejected_at, verification_error, moderation_status, created_at, updated_at, deleted_at, thumbnail_status, thumbnail_storage_path, thumbnail_error, guests(full_name)",
    )
    .eq("wedding_id", adminProfile.wedding_id)
    .order("created_at", { ascending: false })
    .range(pageStart, pageEnd);

  if (filter === "approved") {
    photoQuery = photoQuery
      .eq("verification_status", ACCEPTED_PHOTO_UPLOAD_FILTER.verification_status)
      .eq("moderation_status", ACCEPTED_PHOTO_UPLOAD_FILTER.moderation_status)
      .is("deleted_at", ACCEPTED_PHOTO_UPLOAD_FILTER.deleted_at);
  } else if (filter === "pending") {
    photoQuery = photoQuery
      .eq("verification_status", "verified")
      .eq("moderation_status", "pending")
      .is("deleted_at", null);
  } else if (filter === "hidden") {
    photoQuery = photoQuery.eq("moderation_status", "hidden").is("deleted_at", null);
  } else if (filter === "rejected") {
    photoQuery = photoQuery.eq("verification_status", "rejected").is("deleted_at", null);
  } else if (filter === "verifying") {
    photoQuery = photoQuery.eq("verification_status", "pending").is("deleted_at", null);
  } else if (filter === "deleted") {
    photoQuery = photoQuery.not("deleted_at", "is", null);
  }

  const { data, error: photoError } = await photoQuery;
  const error = countError ?? photoError;
  const rows = (data ?? []).filter(isPhotoUploadRow);
  const photos = await signPhotos(supabase, rows);
  const firstVisible = photos.length === 0 ? 0 : pageStart + 1;
  const lastVisible = photos.length === 0 ? 0 : Math.min(pageStart + photos.length, totalCount);

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Photos
            </h1>
            <p className="mt-2 max-w-2xl text-zinc-600">
              Review guest uploads, keep hidden photos out of public views, and export the approved set.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              className="rounded-full bg-zinc-950 px-5 py-3 text-center font-medium text-white transition hover:bg-zinc-800"
              href="/admin/photos/export"
            >
              Download approved ZIP
            </a>
            <Link
              className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
              href="/admin"
            >
              Back to dashboard
            </Link>
          </div>
        </div>

        {message ? (
          <div
            aria-live="polite"
            className={`rounded-2xl px-5 py-4 text-sm font-medium ${
              message.tone === "error"
                ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
            }`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

        <PhotoListRefresh />

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Photo uploads</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Showing {firstVisible}-{lastVisible} of {totalCount} upload{totalCount === 1 ? "" : "s"}. Approved means verified, not hidden, and not deleted.
              </p>
            </div>
            <nav aria-label="Photo filters" className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <Link
                  aria-current={item.value === filter ? "page" : undefined}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    item.value === filter
                      ? "bg-zinc-950 text-white"
                      : "border border-zinc-300 text-zinc-800 hover:bg-zinc-100"
                  }`}
                  href={getPhotosHref(item.value, 1)}
                  key={item.value}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          {error ? (
            <p className="mt-8 rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100">
              Could not load photo uploads. Please try again.
            </p>
          ) : null}

          {photos.length ? (
            <div className="mt-8 grid gap-5">
              {photos.map((photo) => (
                <article
                  className="grid gap-5 rounded-3xl bg-zinc-50 p-5 ring-1 ring-zinc-200 lg:grid-cols-[180px_1fr]"
                  key={photo.id}
                >
                  <div className="overflow-hidden rounded-2xl bg-zinc-200 ring-1 ring-zinc-200">
                    {photo.previewUrl ? (
                      <img
                        alt={`Preview of ${readableFileName(photo)}`}
                        className="aspect-square h-full w-full object-cover"
                        src={photo.previewUrl}
                      />
                    ) : (
                      <div className="flex aspect-square h-full w-full items-center justify-center px-4 text-center text-sm text-zinc-500">
                        Preview unavailable
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="break-all text-lg font-semibold text-zinc-950">
                          {readableFileName(photo)}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-500">
                          Uploaded {formatUploadedAt(photo.created_at)} by {photo.guestName ?? "anonymous guest"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${getVerificationPill(photo.verification_status)}`}
                        >
                          {photo.verification_status}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${getModerationPill(photo.moderation_status, photo.deleted_at)}`}
                        >
                          {getModerationLabel(photo.moderation_status, photo.deleted_at)}
                        </span>
                      </div>
                    </div>

                    <dl className="grid gap-3 text-sm text-zinc-700 md:grid-cols-3">
                      <div>
                        <dt className="font-medium text-zinc-950">Public/export state</dt>
                        <dd>{getPublicState(photo)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-zinc-950">File</dt>
                        <dd>
                          {photo.mime_type ?? "Unknown type"} · {formatBytes(photo.size_bytes)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-zinc-950">Thumbnail</dt>
                        <dd className="capitalize">
                          {photo.thumbnail_status ?? "unavailable"}
                          {photo.thumbnail_error ? ` (${photo.thumbnail_error})` : ""}
                        </dd>
                      </div>
                    </dl>

                    {photo.note ? (
                      <blockquote className="rounded-2xl bg-white px-4 py-3 text-sm text-zinc-700 ring-1 ring-zinc-200">
                        {photo.note}
                      </blockquote>
                    ) : (
                      <p className="text-sm text-zinc-500">No guest note.</p>
                    )}

                    {photo.verification_error ? (
                      <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-100">
                        Verification error: {photo.verification_error}
                      </p>
                    ) : null}

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <PhotoModerationActions
                        currentFilter={filter}
                        deletedAt={photo.deleted_at}
                        fileName={readableFileName(photo)}
                        moderationStatus={photo.moderation_status}
                        photoId={photo.id}
                        verificationStatus={photo.verification_status}
                      />
                      {photo.originalUrl ? (
                        <a
                          className="rounded-full border border-zinc-300 px-4 py-2 text-center text-sm font-medium text-zinc-900 transition hover:bg-zinc-100"
                          href={photo.originalUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Open original
                        </a>
                      ) : null}
                    </div>

                    <p className="text-xs text-zinc-500">
                      Storage path: <span className="break-all font-mono">{photo.storage_path}</span>
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {!photos.length && !error ? (
            <p className="mt-8 rounded-2xl bg-zinc-50 px-5 py-4 text-sm text-zinc-600">
              No photo uploads match this filter yet.
            </p>
          ) : null}

          {totalPages > 1 ? (
            <nav
              aria-label="Photo pagination"
              className="mt-8 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-zinc-500">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                {currentPage > 1 ? (
                  <Link
                    className="rounded-full border border-zinc-300 px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-100"
                    href={getPhotosHref(filter, currentPage - 1)}
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded-full border border-zinc-200 px-4 py-2 font-medium text-zinc-400">
                    Previous
                  </span>
                )}
                {currentPage < totalPages ? (
                  <Link
                    className="rounded-full border border-zinc-300 px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-100"
                    href={getPhotosHref(filter, currentPage + 1)}
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded-full border border-zinc-200 px-4 py-2 font-medium text-zinc-400">
                    Next
                  </span>
                )}
              </div>
            </nav>
          ) : null}
        </section>
      </section>
    </main>
  );
}
