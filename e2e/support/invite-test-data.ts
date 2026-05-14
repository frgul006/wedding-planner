import { hashInviteToken } from "../../lib/invite-token-crypto";
import { INVITE_STATUS, type InviteStatus } from "../../lib/invite-status";
import type { RsvpAttendance } from "../../lib/rsvp-attendance";

import { E2E_GUEST_PREFIX } from "./admin-guests";
import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";
import { uniqueE2eValue } from "./unique";

type CreateInviteTestGuestOptions = {
  attendance?: RsvpAttendance;
  email?: string;
  extraGuests?: number;
  foodPreference?: string | null;
  fullName: string;
  inviteStatus?: InviteStatus;
  notes?: string | null;
  phone?: string | null;
  token: string;
};

export function uniqueInviteToken(label: string) {
  return uniqueE2eValue("e2e", label, { slug: true });
}

export async function createInviteTestGuest({
  attendance,
  email,
  extraGuests = 0,
  foodPreference = null,
  fullName,
  inviteStatus = INVITE_STATUS.notReplied,
  notes = null,
  phone = null,
  token,
}: CreateInviteTestGuestOptions) {
  const supabase = createE2eSupabaseAdminClient();
  const { data: guest, error: guestError } = await supabase
    .from("guests")
    .insert({
      email: email ?? `${token}@example.com`,
      full_name: fullName,
      invite_status: inviteStatus,
      notes,
      phone,
      wedding_id: SEEDED_WEDDING_ID,
    })
    .select("id")
    .single();

  if (guestError) {
    throw guestError;
  }

  const { data: inviteToken, error: tokenError } = await supabase
    .from("invite_tokens")
    .insert({
      guest_id: guest.id,
      is_active: true,
      token_hash: hashInviteToken(token),
      wedding_id: SEEDED_WEDDING_ID,
    })
    .select("id")
    .single();

  if (tokenError) {
    throw tokenError;
  }

  if (attendance) {
    const { error: rsvpError } = await supabase.from("rsvp_responses").insert({
      allergy_notes: notes,
      attendance,
      extra_guests: extraGuests,
      food_preference: foodPreference,
      guest_id: guest.id,
      updated_via_token_id: inviteToken.id,
      wedding_id: SEEDED_WEDDING_ID,
    });

    if (rsvpError) {
      throw rsvpError;
    }
  }

  if (typeof guest.id !== "string" || typeof inviteToken.id !== "string") {
    throw new Error("Expected Supabase to return inserted guest and invite token ids.");
  }

  return {
    guestId: guest.id,
    tokenId: inviteToken.id,
  };
}

export async function getRsvpResponseForGuest(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("rsvp_responses")
    .select("allergy_notes, attendance, extra_guests, food_preference, guest_id")
    .eq("guest_id", guestId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getRsvpResponseCountForGuest(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { count, error } = await supabase
    .from("rsvp_responses")
    .select("id", { count: "exact", head: true })
    .eq("guest_id", guestId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export function uniqueRsvpGuestName(label: string) {
  return uniqueE2eValue(`${E2E_GUEST_PREFIX} RSVP`, label);
}
