import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { isRecord } from "@/lib/type-guards";
import { getGuestNavigationCookieValue } from "@/lib/guest-navigation-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveWeddingHubContext } from "@/lib/wedding-hub-photo";
import {
  MAX_HUB_FILES_PER_REQUEST,
  MAX_PHOTO_NOTE_LENGTH,
} from "@/lib/wedding-hub-photo-upload";
import {
  FinalizeRequest,
  finalizePhotoUploads,
} from "@/lib/wedding-hub-photo-verification";

function parseFinalizeRequest(body: unknown): FinalizeRequest["uploads"] | null {
  if (!isRecord(body)) {
    return null;
  }

  const rawUploads = body.uploads;
  if (
    !Array.isArray(rawUploads) ||
    rawUploads.length < 1 ||
    rawUploads.length > MAX_HUB_FILES_PER_REQUEST
  ) {
    return null;
  }

  const normalized: Array<{
    clientId: string;
    originalClaim: string;
    originalFileName: string;
    note?: string;
    thumbnailClaim?: string;
  }> = [];

  for (const raw of rawUploads) {
    if (!isRecord(raw)) {
      return null;
    }

    const item = raw;
    const clientId =
      typeof item.clientId === "string" && item.clientId ? item.clientId : randomUUID();

    if (typeof item.originalClaim !== "string" || typeof item.originalFileName !== "string") {
      return null;
    }

    const note = typeof item.note === "string" ? item.note.slice(0, MAX_PHOTO_NOTE_LENGTH) : undefined;

    normalized.push({
      clientId: clientId.slice(0, 128),
      originalClaim: item.originalClaim,
      originalFileName: item.originalFileName.slice(0, 255),
      note,
      thumbnailClaim: typeof item.thumbnailClaim === "string" ? item.thumbnailClaim : undefined,
    });
  }

  return normalized;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const uploads = parseFinalizeRequest(body);

  if (!uploads) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (!uploads.length) {
    return NextResponse.json({ error: "no_uploads" }, { status: 400 });
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

  if (!context.uploadAllowed) {
    return NextResponse.json({ error: "upload_not_allowed", uploadAllowed: false }, { status: 403 });
  }

  const result = await finalizePhotoUploads({
    supabase,
    wedding: context.wedding,
    attribution: context.attribution,
    items: uploads,
  });

  return NextResponse.json({
    results: result,
    total: result.length,
    succeeded: result.filter((row) => row.success).length,
  });
}
