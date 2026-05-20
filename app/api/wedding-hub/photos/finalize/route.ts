import { type NextRequest, NextResponse } from "next/server";

import { getGuestNavigationCookieValue } from "@/lib/guest-navigation-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveWeddingHubAccess } from "@/lib/wedding-hub-access";
import { finalizeHubPhotoUploadsCommand } from "@/lib/wedding-hub-photo-upload-command";
import { finalizePhotoUploads } from "@/lib/wedding-hub-photo-verification";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const cookieValue = getGuestNavigationCookieValue(request);
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  const getSupabase = () => {
    supabase ??= createSupabaseAdminClient();
    return supabase;
  };
  const result = await finalizeHubPhotoUploadsCommand({
    body,
    finalizeUploads: ({ context, uploads }) =>
      finalizePhotoUploads({
        attribution: context.attribution,
        items: uploads,
        supabase: getSupabase(),
        wedding: context.wedding,
      }),
    loadHubContext: () =>
      resolveWeddingHubAccess({
        existingCookieValue: cookieValue,
        supabase: getSupabase(),
      }),
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}
