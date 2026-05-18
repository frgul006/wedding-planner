import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createOrRefreshGuestNavigationSession,
  GUEST_NAVIGATION_COOKIE_NAME,
  getGuestNavigationCookieOptions,
} from "@/lib/guest-navigation-session";
import { hashInviteToken } from "@/lib/invite-token-crypto";
import { isRsvpAttendance, type RsvpAttendance } from "@/lib/rsvp-attendance";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadInviteWeddingSettings,
  type InviteWeddingSettings,
} from "@/lib/wedding-settings";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type InviteAccessScope = "full" | "scoped";

type GuestKind = "invited" | "plus_one";

type GuestRelation = {
  deleted_at: string | null;
  full_name: string | null;
  guest_kind: string;
  phone: string | null;
  plus_one_allowed: boolean;
  sms_opt_in: boolean;
};

export type InviteTokenIdentity = {
  accessScope: InviteAccessScope;
  guestId: string;
  inviteTokenId: string;
  weddingId: string;
};

export type InviteRsvpResponse = {
  allergy_notes: string | null;
  attendance: RsvpAttendance;
  extra_guests: number;
  food_preference: string | null;
  plus_one_allergy_notes: string | null;
  plus_one_email: string | null;
  plus_one_food_preference: string | null;
  plus_one_name: string | null;
  plus_one_phone: string | null;
  plus_one_sms_opt_in: boolean;
  last_submitted_at: string;
};

export type InviteWedding = InviteWeddingSettings;

type ValidGuestRelation = GuestRelation & {
  full_name: string;
  guest_kind: GuestKind;
};

type InviteTokenRow = {
  access_scope: string;
  id: string;
  guest_id: string;
  guests: unknown;
  wedding_id: string;
};

type RsvpResponseRow = Omit<InviteRsvpResponse, "attendance"> & {
  attendance: string | null;
};

export type GrantedInviteAccess = InviteTokenIdentity & {
  canSubmitRsvp: boolean;
  status: "granted";
  guest: {
    full_name: string;
    phone: string | null;
    plus_one_allowed: boolean;
    sms_opt_in: boolean;
  };
  wedding: InviteWedding;
};

export type GrantedInviteAccessWithRsvp = GrantedInviteAccess & {
  rsvpResponse: InviteRsvpResponse | null;
};

export type DeniedInviteAccess = {
  status: "denied";
};

export type InviteAccessResult = GrantedInviteAccessWithRsvp | DeniedInviteAccess;
export type InviteAccessIdentityResult = GrantedInviteAccess | DeniedInviteAccess;

export type PreparedGuestNavigationSessionCookie = {
  name: typeof GUEST_NAVIGATION_COOKIE_NAME;
  options: ReturnType<typeof getGuestNavigationCookieOptions>;
  value: string;
};

const inviteTokenContextSelect = `
  access_scope,
  id,
  guest_id,
  wedding_id,
  guests!invite_tokens_guest_wedding_fk!inner(
    deleted_at,
    full_name,
    guest_kind,
    phone,
    plus_one_allowed,
    sms_opt_in
  )
`;

function getSingleRelation(relation: unknown) {
  return Array.isArray(relation) ? relation[0] : relation;
}

function isGuestRelation(value: unknown): value is GuestRelation {
  return (
    isRecord(value) &&
    isNullableString(value.deleted_at) &&
    isNullableString(value.full_name) &&
    typeof value.guest_kind === "string" &&
    isNullableString(value.phone) &&
    typeof value.plus_one_allowed === "boolean" &&
    typeof value.sms_opt_in === "boolean"
  );
}

function isInviteTokenRow(value: unknown): value is InviteTokenRow {
  return (
    isRecord(value) &&
    typeof value.access_scope === "string" &&
    typeof value.id === "string" &&
    typeof value.guest_id === "string" &&
    typeof value.wedding_id === "string"
  );
}

function isInviteAccessScope(value: unknown): value is InviteAccessScope {
  return value === "full" || value === "scoped";
}

function isGuestKind(value: unknown): value is GuestKind {
  return value === "invited" || value === "plus_one";
}

function isRsvpResponseRow(value: unknown): value is RsvpResponseRow {
  return (
    isRecord(value) &&
    isNullableString(value.allergy_notes) &&
    isNullableString(value.attendance) &&
    typeof value.extra_guests === "number" &&
    isNullableString(value.food_preference) &&
    isNullableString(value.plus_one_allergy_notes) &&
    isNullableString(value.plus_one_email) &&
    isNullableString(value.plus_one_food_preference) &&
    isNullableString(value.plus_one_name) &&
    isNullableString(value.plus_one_phone) &&
    typeof value.plus_one_sms_opt_in === "boolean" &&
    typeof value.last_submitted_at === "string"
  );
}

function normalizeRsvpResponse(value: unknown): InviteRsvpResponse | null {
  if (!isRsvpResponseRow(value)) {
    return null;
  }

  if (!isRsvpAttendance(value.attendance)) {
    return null;
  }

  return {
    allergy_notes: value.allergy_notes,
    attendance: value.attendance,
    extra_guests: value.extra_guests,
    food_preference: value.food_preference,
    plus_one_allergy_notes: value.plus_one_allergy_notes,
    plus_one_email: value.plus_one_email,
    plus_one_food_preference: value.plus_one_food_preference,
    plus_one_name: value.plus_one_name,
    plus_one_phone: value.plus_one_phone,
    plus_one_sms_opt_in: value.plus_one_sms_opt_in,
    last_submitted_at: value.last_submitted_at,
  };
}

function toGrantedInviteAccess({
  accessScope,
  guest,
  guestId,
  inviteTokenId,
  wedding,
  weddingId,
}: InviteTokenIdentity & {
  guest: ValidGuestRelation;
  wedding: InviteWedding;
}): GrantedInviteAccess {
  return {
    accessScope,
    canSubmitRsvp: accessScope === "full",
    status: "granted",
    guestId,
    inviteTokenId,
    weddingId,
    guest: {
      full_name: guest.full_name,
      phone: guest.phone,
      plus_one_allowed: guest.plus_one_allowed,
      sms_opt_in: guest.sms_opt_in,
    },
    wedding,
  };
}

async function resolveGrantedInviteAccess(
  rawToken: string,
  supabase: SupabaseClient,
): Promise<GrantedInviteAccess | null> {
  if (!rawToken) {
    return null;
  }

  const tokenHash = hashInviteToken(rawToken);
  const { data, error } = await supabase
    .from("invite_tokens")
    .select(inviteTokenContextSelect)
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("Failed to resolve Invite access", error);
    }

    return null;
  }

  if (!isInviteTokenRow(data)) {
    return null;
  }

  const guest = getSingleRelation(data.guests);

  if (
    !isInviteAccessScope(data.access_scope) ||
    !isGuestRelation(guest) ||
    !isGuestKind(guest.guest_kind) ||
    !guest.full_name ||
    guest.deleted_at
  ) {
    return null;
  }

  const hasValidScopeForGuestKind =
    (data.access_scope === "full" && guest.guest_kind === "invited") ||
    (data.access_scope === "scoped" && guest.guest_kind === "plus_one");

  if (!hasValidScopeForGuestKind) {
    return null;
  }

  const wedding = await loadInviteWeddingSettings({
    supabase,
    weddingId: data.wedding_id,
  });

  if (!wedding) {
    return null;
  }

  return toGrantedInviteAccess({
    accessScope: data.access_scope,
    guest: {
      ...guest,
      full_name: guest.full_name,
      guest_kind: guest.guest_kind,
    },
    guestId: data.guest_id,
    inviteTokenId: data.id,
    wedding,
    weddingId: data.wedding_id,
  });
}

async function loadInviteRsvpResponse(
  grantedAccess: Pick<GrantedInviteAccess, "guestId" | "weddingId">,
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .from("rsvp_responses")
    .select(
      "allergy_notes, attendance, extra_guests, food_preference, plus_one_allergy_notes, plus_one_email, plus_one_food_preference, plus_one_name, plus_one_phone, plus_one_sms_opt_in, last_submitted_at",
    )
    .eq("guest_id", grantedAccess.guestId)
    .eq("wedding_id", grantedAccess.weddingId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load RSVP response for Invite access", error);
  }

  return normalizeRsvpResponse(data);
}

type ResolveInviteAccessOptions = {
  includeRsvpResponse?: boolean;
  supabase?: SupabaseClient;
};

type ResolveInviteAccessWithRsvpOptions = {
  includeRsvpResponse?: true;
  supabase?: SupabaseClient;
};

type ResolveInviteAccessIdentityOptions = {
  includeRsvpResponse: false;
  supabase?: SupabaseClient;
};

export async function resolveInviteAccess(
  rawToken: string,
  options: ResolveInviteAccessIdentityOptions,
): Promise<InviteAccessIdentityResult>;
export async function resolveInviteAccess(
  rawToken: string,
  options?: ResolveInviteAccessWithRsvpOptions,
): Promise<InviteAccessResult>;
export async function resolveInviteAccess(
  rawToken: string,
  options: ResolveInviteAccessOptions = {},
): Promise<InviteAccessResult | InviteAccessIdentityResult> {
  const supabase = options.supabase ?? createSupabaseAdminClient();
  const grantedAccess = await resolveGrantedInviteAccess(rawToken, supabase);

  if (!grantedAccess) {
    return { status: "denied" };
  }

  if (options.includeRsvpResponse === false) {
    return grantedAccess;
  }

  return {
    ...grantedAccess,
    rsvpResponse: grantedAccess.canSubmitRsvp
      ? await loadInviteRsvpResponse(grantedAccess, supabase)
      : null,
  };
}

export async function recordInviteOpened(
  grantedAccess: Pick<GrantedInviteAccess, "guestId" | "weddingId">,
  options: { supabase?: SupabaseClient } = {},
) {
  const supabase = options.supabase ?? createSupabaseAdminClient();
  const { error } = await supabase.rpc("mark_invite_opened", {
    p_guest_id: grantedAccess.guestId,
    p_wedding_id: grantedAccess.weddingId,
  });

  if (error) {
    console.error("Failed to record Invite opened", error);
  }
}

export async function prepareGuestNavigationSession(
  grantedAccess: Pick<
    GrantedInviteAccess,
    "guestId" | "inviteTokenId" | "weddingId"
  >,
  {
    existingCookieValue,
    metadata,
    supabase = createSupabaseAdminClient(),
  }: {
    existingCookieValue: string | null;
    metadata: Record<string, string> | null;
    supabase?: SupabaseClient;
  },
): Promise<PreparedGuestNavigationSessionCookie | null> {
  const sessionCookie = await createOrRefreshGuestNavigationSession({
    existingCookieValue,
    guestId: grantedAccess.guestId,
    inviteTokenId: grantedAccess.inviteTokenId,
    metadata,
    supabase,
    weddingId: grantedAccess.weddingId,
  });

  if (!sessionCookie) {
    return null;
  }

  return {
    name: GUEST_NAVIGATION_COOKIE_NAME,
    value: sessionCookie.cookieValue,
    options: getGuestNavigationCookieOptions(sessionCookie.expiresAt),
  };
}
