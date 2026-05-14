import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getGuestNavigationCookieValue } from "@/lib/guest-navigation-session";
import { MAX_HUB_FILES_PER_REQUEST, MAX_PHOTO_NOTE_LENGTH } from "@/lib/photo-upload";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isRecord } from "@/lib/type-guards";
import { resolveWeddingHubContext } from "@/lib/wedding-hub-photo";
import { createSignedUploadIntents, type UploadFileInput } from "@/lib/wedding-hub-photo-upload";

type SignRequestUploadPayload = {
  clientId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  note?: unknown;
};

function parseSignUploads(body: unknown): UploadFileInput[] | null {
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
      clientId: typeof payload.clientId === "string" ? payload.clientId : randomUUID(),
      fileName: typeof payload.fileName === "string" ? payload.fileName : "",
      mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "",
      sizeBytes: Math.trunc(normalizedSize),
      note: typeof payload.note === "string" ? payload.note : "",
    });
  }

  return normalized;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const uploads = parseSignUploads(body);

  if (!uploads) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (!uploads.length || uploads.length > MAX_HUB_FILES_PER_REQUEST) {
    return NextResponse.json({ error: "invalid_file_count" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const cookieValue = getGuestNavigationCookieValue(request);
  const context = await resolveWeddingHubContext({
    supabase,
    existingCookieValue: cookieValue,
  });

  if (!context) {
    return NextResponse.json({ error: "wedding_not_found" }, { status: 404 });
  }

  const inputs: UploadFileInput[] = uploads.map((item, index) => ({
    ...item,
    clientId: item.clientId || `file-${index}`,
    note: item.note && item.note.length > MAX_PHOTO_NOTE_LENGTH
      ? item.note.slice(0, MAX_PHOTO_NOTE_LENGTH)
      : item.note,
  }));

  if (!context.uploadAllowed) {
    return NextResponse.json(
      {
        uploadAllowed: false,
        requiresReview: context.wedding.photo_upload_requires_review,
        maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
        uploadIntents: [],
      },
      { status: 403 },
    );
  }

  try {
    const result = await createSignedUploadIntents({
      inputs,
      wedding: context.wedding,
      supabase,
    });

    return NextResponse.json({
      ...result,
      uploadAllowed: true,
      requiresReview: context.wedding.photo_upload_requires_review,
      maxFilesPerRequest: MAX_HUB_FILES_PER_REQUEST,
      canUpload: true,
      uploadIntents: result.uploadIntents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 400 },
    );
  }
}
