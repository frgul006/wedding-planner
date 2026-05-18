import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INVITE_OPENED_STATUS,
  RSVP_STATUS,
  isInviteOpenedStatus,
  isInviteStatus,
  isRsvpStatus,
  type InviteOpenedStatus,
  type InviteStatus,
  type RsvpStatus,
} from "@/lib/invite-status";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type AdminGuestRosterSort = "name" | "name-desc" | "status" | "newest";
export type GuestKind = "invited" | "plus_one";
export type InviteAccessScope = "full" | "scoped";

export type AdminGuestRosterSearchParams = {
  q?: string | string[];
  sort?: string | string[];
  status?: string | string[];
};

export type AdminGuestRosterFilters = {
  query: string;
  sort: AdminGuestRosterSort;
  status: InviteStatus | "";
};

export type AdminGuestRosterRsvpDetails = {
  allergyNotes: string | null;
  extraGuests: number;
  foodPreference: string | null;
  submittedAtLabel: string | null;
};

export type AdminGuestRosterRow = {
  canEditIdentity: boolean;
  canEditPlusOneAllowed: boolean;
  canEditSmsOptIn: boolean;
  canSave: boolean;
  email: string | null;
  fullName: string;
  guestKind: GuestKind;
  guestKindLabel: string;
  hasActiveToken: boolean;
  id: string;
  inviteAccessScope: InviteAccessScope;
  inviteStatus: InviteOpenedStatus;
  notes: string | null;
  phone: string | null;
  plusOneAllowed: boolean;
  rsvpDetails: AdminGuestRosterRsvpDetails | null;
  rsvpManaged: boolean;
  rsvpStatus: RsvpStatus;
  rsvpStatusLabel: string;
  smsOptIn: boolean;
  tiedInvitedGuestText: string | null;
};

export type LoadAdminGuestRosterResult = {
  error: object | null;
  filters: AdminGuestRosterFilters;
  rows: AdminGuestRosterRow[];
};

export type AdminGuestRosterGuestRow = {
  created_at: string;
  email: string | null;
  full_name: string;
  guest_kind: GuestKind;
  id: string;
  invite_status: InviteOpenedStatus;
  invited_guest_id: string | null;
  notes: string | null;
  phone: string | null;
  plus_one_allowed: boolean;
  rsvp_managed: boolean;
  rsvp_status: RsvpStatus;
  sms_opt_in: boolean;
};

export type AdminGuestRosterActiveInviteTokenRow = {
  guest_id: string;
};

export type AdminGuestRosterInvitedGuestRow = {
  full_name: string;
  id: string;
};

export type AdminGuestRosterRsvpResponseRow = {
  allergy_notes: string | null;
  extra_guests: number;
  food_preference: string | null;
  guest_id: string;
  last_submitted_at: string | null;
  plus_one_allergy_notes: string | null;
  plus_one_food_preference: string | null;
};

export const ADMIN_GUEST_ROSTER_SORTS = [
  "name",
  "name-desc",
  "status",
  "newest",
] as const satisfies readonly AdminGuestRosterSort[];

const GUEST_SELECT =
  "id, full_name, email, phone, notes, guest_kind, invited_guest_id, invite_status, rsvp_managed, rsvp_status, sms_opt_in, plus_one_allowed, created_at";
const RSVP_RESPONSE_SELECT =
  "guest_id, allergy_notes, extra_guests, food_preference, plus_one_allergy_notes, plus_one_food_preference, last_submitted_at";

const rsvpSubmittedFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isAdminGuestRosterSort(value: unknown): value is AdminGuestRosterSort {
  return (
    typeof value === "string" &&
    ADMIN_GUEST_ROSTER_SORTS.some((sort) => sort === value)
  );
}

function isGuestKind(value: unknown): value is GuestKind {
  return value === "invited" || value === "plus_one";
}

function getGuestKindLabel(guestKind: GuestKind) {
  return guestKind === "plus_one" ? "Plus-one Guest" : "Invited Guest";
}

function getInviteAccessScope(guestKind: GuestKind): InviteAccessScope {
  return guestKind === "plus_one" ? "scoped" : "full";
}

function getRsvpStatusLabel(rsvpStatus: RsvpStatus) {
  return rsvpStatus === RSVP_STATUS.notReplied ? "not submitted" : rsvpStatus;
}

function formatRsvpSubmittedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return rsvpSubmittedFormatter.format(date);
}

export function normalizeAdminGuestRosterFilters(
  searchParams: AdminGuestRosterSearchParams,
): AdminGuestRosterFilters {
  const rawQuery = getFirstParam(searchParams.q);
  const rawSort = getFirstParam(searchParams.sort);
  const rawStatus = getFirstParam(searchParams.status);

  return {
    query: (rawQuery ?? "").trim(),
    sort: isAdminGuestRosterSort(rawSort) ? rawSort : "name",
    status: isInviteStatus(rawStatus) ? rawStatus : "",
  };
}

function isAdminGuestRosterGuestRow(value: unknown): value is AdminGuestRosterGuestRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string" &&
    isNullableString(value.email) &&
    isNullableString(value.phone) &&
    isNullableString(value.notes) &&
    isGuestKind(value.guest_kind) &&
    isNullableString(value.invited_guest_id) &&
    isInviteOpenedStatus(value.invite_status) &&
    typeof value.rsvp_managed === "boolean" &&
    isRsvpStatus(value.rsvp_status) &&
    typeof value.sms_opt_in === "boolean" &&
    typeof value.plus_one_allowed === "boolean" &&
    typeof value.created_at === "string"
  );
}

function isAdminGuestRosterActiveInviteTokenRow(
  value: unknown,
): value is AdminGuestRosterActiveInviteTokenRow {
  return isRecord(value) && typeof value.guest_id === "string";
}

function isAdminGuestRosterInvitedGuestRow(
  value: unknown,
): value is AdminGuestRosterInvitedGuestRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string"
  );
}

function isAdminGuestRosterRsvpResponseRow(
  value: unknown,
): value is AdminGuestRosterRsvpResponseRow {
  return (
    isRecord(value) &&
    typeof value.guest_id === "string" &&
    isNullableString(value.allergy_notes) &&
    typeof value.extra_guests === "number" &&
    isNullableString(value.food_preference) &&
    isNullableString(value.plus_one_allergy_notes) &&
    isNullableString(value.plus_one_food_preference) &&
    isNullableString(value.last_submitted_at)
  );
}

function getRsvpDetailsForGuest(
  guest: AdminGuestRosterGuestRow,
  rsvpResponsesByGuest: Map<string, AdminGuestRosterRsvpResponseRow>,
): AdminGuestRosterRsvpDetails | null {
  const response =
    guest.guest_kind === "plus_one" && guest.invited_guest_id
      ? rsvpResponsesByGuest.get(guest.invited_guest_id)
      : rsvpResponsesByGuest.get(guest.id);

  if (!response) {
    return null;
  }

  if (guest.guest_kind === "plus_one") {
    return {
      allergyNotes: response.plus_one_allergy_notes,
      extraGuests: response.extra_guests,
      foodPreference: response.plus_one_food_preference,
      submittedAtLabel: formatRsvpSubmittedAt(response.last_submitted_at),
    };
  }

  return {
    allergyNotes: response.allergy_notes,
    extraGuests: response.extra_guests,
    foodPreference: response.food_preference,
    submittedAtLabel: formatRsvpSubmittedAt(response.last_submitted_at),
  };
}

export function buildAdminGuestRosterRows({
  activeInviteTokenRows,
  guestRows,
  rsvpResponses,
  tiedInvitedGuests,
}: {
  activeInviteTokenRows: unknown[];
  guestRows: unknown[];
  rsvpResponses: unknown[];
  tiedInvitedGuests: unknown[];
}): AdminGuestRosterRow[] {
  const guestsWithActiveTokens = new Set(
    activeInviteTokenRows
      .filter(isAdminGuestRosterActiveInviteTokenRow)
      .map((token) => token.guest_id),
  );
  const invitedGuestNamesById = new Map(
    tiedInvitedGuests
      .filter(isAdminGuestRosterInvitedGuestRow)
      .map((guest) => [guest.id, guest.full_name]),
  );
  const rsvpResponsesByGuest = new Map(
    rsvpResponses
      .filter(isAdminGuestRosterRsvpResponseRow)
      .map((response) => [response.guest_id, response]),
  );

  return guestRows.filter(isAdminGuestRosterGuestRow).map((guest) => {
    const isPlusOneGuest = guest.guest_kind === "plus_one";
    const canEditIdentity = !guest.rsvp_managed;

    return {
      canEditIdentity,
      canEditPlusOneAllowed: canEditIdentity && !isPlusOneGuest,
      canEditSmsOptIn: canEditIdentity,
      canSave: !guest.rsvp_managed,
      email: guest.email,
      fullName: guest.full_name,
      guestKind: guest.guest_kind,
      guestKindLabel: getGuestKindLabel(guest.guest_kind),
      hasActiveToken: guestsWithActiveTokens.has(guest.id),
      id: guest.id,
      inviteAccessScope: getInviteAccessScope(guest.guest_kind),
      inviteStatus: guest.invite_status,
      notes: guest.notes,
      phone: guest.phone,
      plusOneAllowed: guest.plus_one_allowed,
      rsvpDetails: getRsvpDetailsForGuest(guest, rsvpResponsesByGuest),
      rsvpManaged: guest.rsvp_managed,
      rsvpStatus: guest.rsvp_status,
      rsvpStatusLabel: getRsvpStatusLabel(guest.rsvp_status),
      smsOptIn: guest.sms_opt_in,
      tiedInvitedGuestText:
        isPlusOneGuest && guest.invited_guest_id
          ? `Tied to ${invitedGuestNamesById.get(guest.invited_guest_id) ?? "unknown Invited Guest"}`
          : null,
    };
  });
}

export async function loadAdminGuestRoster({
  filters,
  supabase,
  weddingId,
}: {
  filters: AdminGuestRosterFilters;
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<LoadAdminGuestRosterResult> {
  let guestsQuery = supabase
    .from("guests")
    .select(GUEST_SELECT)
    .eq("wedding_id", weddingId)
    .is("deleted_at", null)
    .limit(500);

  if (filters.query) {
    const escapedQuery = filters.query.replaceAll("%", "\\%").replaceAll("_", "\\_");
    guestsQuery = guestsQuery.or(
      `full_name.ilike.%${escapedQuery}%,phone.ilike.%${escapedQuery}%`,
    );
  }

  if (
    filters.status === INVITE_OPENED_STATUS.notReplied ||
    filters.status === INVITE_OPENED_STATUS.opened
  ) {
    guestsQuery = guestsQuery
      .eq("invite_status", filters.status)
      .eq("rsvp_status", RSVP_STATUS.notReplied);
  } else if (isRsvpStatus(filters.status)) {
    guestsQuery = guestsQuery.eq("rsvp_status", filters.status);
  }

  if (filters.sort === "name-desc") {
    guestsQuery = guestsQuery.order("full_name", { ascending: false });
  } else if (filters.sort === "status") {
    guestsQuery = guestsQuery
      .order("rsvp_status", { ascending: true })
      .order("invite_status", { ascending: true })
      .order("full_name");
  } else if (filters.sort === "newest") {
    guestsQuery = guestsQuery.order("created_at", { ascending: false });
  } else {
    guestsQuery = guestsQuery.order("full_name", { ascending: true });
  }

  const { data, error } = await guestsQuery;
  const guestRows = (data ?? []).filter(isAdminGuestRosterGuestRow);

  if (error) {
    return { error, filters, rows: [] };
  }

  const guestIds = guestRows.map((guest) => guest.id);
  const invitedGuestIds = Array.from(
    new Set(
      guestRows
        .map((guest) => guest.invited_guest_id)
        .filter((guestId): guestId is string => typeof guestId === "string"),
    ),
  );
  const rsvpGuestIds = Array.from(new Set([...guestIds, ...invitedGuestIds]));

  const [activeTokensResult, rsvpResponsesResult, tiedInvitedGuestsResult] = guestIds.length
    ? await Promise.all([
        supabase
          .from("invite_tokens")
          .select("guest_id")
          .eq("wedding_id", weddingId)
          .eq("is_active", true)
          .in("guest_id", guestIds),
        supabase
          .from("rsvp_responses")
          .select(RSVP_RESPONSE_SELECT)
          .eq("wedding_id", weddingId)
          .in("guest_id", rsvpGuestIds),
        invitedGuestIds.length
          ? supabase
              .from("guests")
              .select("id, full_name")
              .eq("wedding_id", weddingId)
              .in("id", invitedGuestIds)
          : Promise.resolve({ data: [], error: null }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  return {
    error:
      activeTokensResult.error ??
      rsvpResponsesResult.error ??
      tiedInvitedGuestsResult.error ??
      null,
    filters,
    rows: buildAdminGuestRosterRows({
      activeInviteTokenRows: activeTokensResult.data ?? [],
      guestRows,
      rsvpResponses: rsvpResponsesResult.data ?? [],
      tiedInvitedGuests: tiedInvitedGuestsResult.data ?? [],
    }),
  };
}
