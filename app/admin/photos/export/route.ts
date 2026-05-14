import type { SupabaseClient } from "@supabase/supabase-js";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  ACCEPTED_PHOTO_UPLOAD_FILTER,
  PHOTO_UPLOAD_BUCKET,
} from "@/lib/photo-upload";
import { normalizePhotoGuestName } from "@/lib/photo-upload-display";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isNullableString, isRecord } from "@/lib/type-guards";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportPhotoRow = {
  id: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  created_at: string;
  guests: unknown;
};

const textEncoder = new TextEncoder();
const exportPageSize = 500;
const signedDownloadTtlSeconds = 10 * 60;

function isExportPhotoRow(value: unknown): value is ExportPhotoRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.storage_path === "string" &&
    isNullableString(value.original_filename) &&
    isNullableString(value.mime_type) &&
    typeof value.created_at === "string"
  );
}

function sanitizeFilePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function extensionFor(row: ExportPhotoRow, originalName: string) {
  const extensionMatch = /\.[a-zA-Z0-9]{2,5}$/.exec(originalName);

  if (extensionMatch) {
    return extensionMatch[0].toLowerCase();
  }

  switch (row.mime_type) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    default:
      return "";
  }
}

function createExportFileName(row: ExportPhotoRow, index: number, seenNames: Map<string, number>) {
  const originalName = row.original_filename ?? row.storage_path.split("/").at(-1) ?? row.id;
  const extension = extensionFor(row, originalName);
  const originalStem = extension ? originalName.slice(0, -extension.length) : originalName;
  const safeStem = sanitizeFilePart(originalStem) || "photo";
  const guestPart = sanitizeFilePart(normalizePhotoGuestName(row.guests) ?? "anonymous") || "anonymous";
  const uploadedDate = row.created_at.slice(0, 10).replace(/[^0-9-]/g, "") || "unknown-date";
  const prefix = String(index + 1).padStart(4, "0");
  const baseName = `${prefix}-${uploadedDate}-${guestPart}-${safeStem}`;
  const name = `${baseName}${extension}`;
  const count = seenNames.get(name) ?? 0;

  seenNames.set(name, count + 1);

  if (count === 0) {
    return name;
  }

  return `${baseName}-${count + 1}${extension}`;
}

async function getApprovedPhotoRows(supabase: SupabaseClient, weddingId: string) {
  const rows: ExportPhotoRow[] = [];
  let cursor: { createdAt: string; id: string } | null = null;

  while (true) {
    let query = supabase
      .from("photo_uploads")
      .select("id, storage_path, original_filename, mime_type, created_at, guests(full_name)")
      .eq("wedding_id", weddingId)
      .eq("verification_status", ACCEPTED_PHOTO_UPLOAD_FILTER.verification_status)
      .eq("moderation_status", ACCEPTED_PHOTO_UPLOAD_FILTER.moderation_status)
      .is("deleted_at", ACCEPTED_PHOTO_UPLOAD_FILTER.deleted_at)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(exportPageSize);

    if (cursor) {
      query = query.or(
        `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data.filter(isExportPhotoRow) : [];
    rows.push(...page);

    if (page.length < exportPageSize) {
      break;
    }

    const last = page.at(-1);
    if (!last) {
      break;
    }

    cursor = { createdAt: last.created_at, id: last.id };
  }

  return rows;
}

async function getStorageObjectChunks(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage
    .from(PHOTO_UPLOAD_BUCKET)
    .createSignedUrl(path, signedDownloadTtlSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Could not sign ${path}`);
  }

  const response = await fetch(data.signedUrl);

  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${path}`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return chunks;
}

async function* exportZipEntries({
  rows,
  supabase,
}: {
  rows: ExportPhotoRow[];
  supabase: SupabaseClient;
}): AsyncIterable<ZipStreamEntry> {
  const seenNames = new Map<string, number>();
  const warnings: string[] = [];
  let exportedCount = 0;

  for (const [index, row] of rows.entries()) {
    const fileName = createExportFileName(row, index, seenNames);

    try {
      const chunks = await getStorageObjectChunks(supabase, row.storage_path);
      exportedCount += 1;
      yield {
        chunks,
        fileName,
        modifiedAt: row.created_at,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to add photo to export", message);
      warnings.push(`${fileName}: skipped because the storage object could not be downloaded.`);
    }
  }

  if (exportedCount === 0) {
    yield {
      chunks: [textEncoder.encode("No approved photos were available for export.\n")],
      fileName: "README.txt",
      modifiedAt: new Date(),
    };
  }

  if (warnings.length > 0) {
    yield {
      chunks: [textEncoder.encode(`${warnings.join("\n")}\n`)],
      fileName: "EXPORT-WARNINGS.txt",
      modifiedAt: new Date(),
    };
  }
}

function exportFileName() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `approved-wedding-photos-${stamp}.zip`;
}

export async function GET() {
  const adminProfile = await requireActiveAdminProfile();
  const supabase = createSupabaseAdminClient();
  const rows = await getApprovedPhotoRows(supabase, adminProfile.wedding_id);
  const stream = createZipStream(exportZipEntries({ rows, supabase }));

  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${exportFileName()}"`,
      "Content-Type": "application/zip",
    },
  });
}
