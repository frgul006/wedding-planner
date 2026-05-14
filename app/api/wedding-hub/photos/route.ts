import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveWeddingHubContext } from "@/lib/wedding-hub-photo";
import { getWeddingHubPhotoData } from "@/lib/wedding-hub-photo-verification";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const context = await resolveWeddingHubContext({
    supabase,
    existingCookieValue: null,
  });

  if (!context) {
    return NextResponse.json({ error: "wedding_not_found" }, { status: 404 });
  }

  const photoData = await getWeddingHubPhotoData({
    supabase,
    wedding: context.wedding,
  });

  return NextResponse.json(photoData);
}
