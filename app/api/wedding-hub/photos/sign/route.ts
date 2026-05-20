import { type NextRequest, NextResponse } from "next/server";

import { getGuestNavigationCookieValue } from "@/lib/guest-navigation-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveWeddingHubAccess } from "@/lib/wedding-hub-access";
import { signHubPhotoUploadsCommand } from "@/lib/wedding-hub-photo-upload-command";
import {
  createSupabaseHubPhotoUploadSigningAdapter,
  type HubPhotoUploadSigningAdapter,
} from "@/lib/wedding-hub-photo-upload";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const cookieValue = getGuestNavigationCookieValue(request);
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  const getSupabase = () => {
    supabase ??= createSupabaseAdminClient();
    return supabase;
  };
  const signingAdapter: HubPhotoUploadSigningAdapter = {
    createSignedUploadUrl(path, options) {
      return createSupabaseHubPhotoUploadSigningAdapter(getSupabase()).createSignedUploadUrl(
        path,
        options,
      );
    },
  };
  const result = await signHubPhotoUploadsCommand({
    body,
    loadHubContext: () =>
      resolveWeddingHubAccess({
        existingCookieValue: cookieValue,
        supabase: getSupabase(),
      }),
    signingAdapter,
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}
