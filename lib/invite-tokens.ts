import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

const TOKEN_BYTES = 32;

export type InviteTokenValidationResult =
  | {
      isValid: true;
      guest: {
        full_name: string;
      };
    }
  | { isValid: false };

export function generateRawInviteToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInviteToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function buildInviteUrl(rawToken: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return new URL(`/invite/${rawToken}`, siteUrl).toString();
}

export async function regenerateInviteToken({
  guestId,
  supabase,
  weddingId,
}: {
  guestId: string;
  supabase: SupabaseClient;
  weddingId: string;
}) {
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
    guest_id: guestId,
    wedding_id: weddingId,
    token_hash: tokenHash,
    is_active: true,
  });

  if (insertError) {
    throw insertError;
  }

  return {
    inviteUrl: buildInviteUrl(rawToken),
    rawToken,
  };
}

export async function validateInviteToken(
  rawToken: string,
): Promise<InviteTokenValidationResult> {
  if (!rawToken) {
    return { isValid: false };
  }

  const supabase = createSupabaseAdminClient();
  const tokenHash = hashInviteToken(rawToken);
  const { data, error } = await supabase
    .from("invite_tokens")
    .select("guests!invite_tokens_guest_wedding_fk!inner(full_name)")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("Failed to validate invite token", error);
    }

    return { isValid: false };
  }

  const guest = Array.isArray(data.guests) ? data.guests[0] : data.guests;

  if (!guest?.full_name) {
    return { isValid: false };
  }

  return {
    isValid: true,
    guest: {
      full_name: guest.full_name,
    },
  };
}
