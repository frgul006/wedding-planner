import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveWeddingHubAccess } from "@/lib/wedding-hub-access";
import { getWeddingHubPhotoData } from "@/lib/wedding-hub-photo-verification";
import { parseHubPhotoCursor } from "@/lib/wedding-hub-photo-cursor";

export async function GET(request: Request) {
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = cursorValue === null ? null : parseHubPhotoCursor(cursorValue);
  if (cursorValue !== null && cursor === null) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const context = await resolveWeddingHubAccess({
    supabase,
    existingCookieValue: null,
  });

  if (!context) {
    return NextResponse.json({ error: "wedding_not_found" }, { status: 404 });
  }

  try {
    const photoData = await getWeddingHubPhotoData({
      supabase,
      wedding: context.wedding,
      cursor,
    });
    return NextResponse.json(photoData);
  } catch (error) {
    console.error("Failed to load hub photos", error);
    return NextResponse.json({ error: "photos_unavailable" }, { status: 500 });
  }
}
