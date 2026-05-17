import type { SupabaseClient } from "@supabase/supabase-js";

import {
  recordInviteOpened,
  resolveInviteAccess,
  type InviteRsvpResponse,
  type InviteTokenIdentity,
  type InviteWedding,
} from "@/lib/invite-access";
import {
  generateRawInviteToken,
  hashInviteToken,
} from "@/lib/invite-token-crypto";
import { buildPublicUrl, type PublicUrlOptions } from "@/lib/public-url";

export type {
  InviteRsvpResponse,
  InviteTokenIdentity,
  InviteWedding,
} from "@/lib/invite-access";

export type InviteTokenValidationResult =
  | {
      isValid: true;
      guestId: string;
      inviteTokenId: string;
      weddingId: string;
      guest: {
        full_name: string;
        phone: string | null;
        plus_one_allowed: boolean;
        sms_opt_in: boolean;
      };
      rsvpResponse: InviteRsvpResponse | null;
      wedding: InviteWedding;
    }
  | { isValid: false };

export function buildInviteUrl(rawToken: string, options?: PublicUrlOptions) {
  return buildPublicUrl(`/invite/${rawToken}`, options);
}

export async function getActiveInviteTokenIdentity(
  rawToken: string,
  supabase?: SupabaseClient,
): Promise<InviteTokenIdentity | null> {
  const access = await resolveInviteAccess(rawToken, {
    includeRsvpResponse: false,
    supabase,
  });

  if (access.status === "denied") {
    return null;
  }

  return {
    guestId: access.guestId,
    inviteTokenId: access.inviteTokenId,
    weddingId: access.weddingId,
  };
}

export async function markInviteOpened({
  guestId,
  weddingId,
}: {
  guestId: string;
  weddingId: string;
}) {
  await recordInviteOpened({ guestId, weddingId });
}

export async function regenerateInviteToken({
  guestId,
  requestOrigin,
  requestUrl,
  supabase,
  weddingId,
}: {
  guestId: string;
  supabase: SupabaseClient;
  weddingId: string;
} & PublicUrlOptions) {
  const rawToken = generateRawInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const now = new Date().toISOString();

  const { error: invalidateError } = await supabase
    .from("invite_tokens")
    .update({
      is_active: false,
      invalidated_at: now,
      regenerated_at: now,
    })
    .eq("guest_id", guestId)
    .eq("wedding_id", weddingId)
    .eq("is_active", true);

  if (invalidateError) {
    throw invalidateError;
  }

  const { error: insertError } = await supabase.from("invite_tokens").insert({
    access_scope: "full",
    guest_id: guestId,
    wedding_id: weddingId,
    token_hash: tokenHash,
    is_active: true,
  });

  if (insertError) {
    throw insertError;
  }

  return {
    inviteUrl: buildInviteUrl(rawToken, { requestOrigin, requestUrl }),
    rawToken,
  };
}

export async function validateInviteToken(
  rawToken: string,
): Promise<InviteTokenValidationResult> {
  const access = await resolveInviteAccess(rawToken);

  if (access.status === "denied") {
    return { isValid: false };
  }

  return {
    isValid: true,
    guestId: access.guestId,
    inviteTokenId: access.inviteTokenId,
    weddingId: access.weddingId,
    guest: access.guest,
    rsvpResponse: access.rsvpResponse,
    wedding: access.wedding,
  };
}
