import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getGuestKindLabel,
  getInviteAccessScopeForGuestKind,
  isGuestKind,
  type GuestKind,
  type InviteAccessScope,
} from "@/lib/guest-access-policy";
import {
  RSVP_STATUS,
  isInviteOpenedStatus,
  isInviteStatus,
  isRsvpStatus,
  type InviteOpenedStatus,
  type InviteStatus,
  type RsvpStatus,
} from "@/lib/invite-status";
import { isNullableString, isRecord } from "@/lib/type-guards";
import { matchesAdminGuestRosterFilters } from "./admin-guest-roster-filters";

export type { GuestKind, InviteAccessScope } from "@/lib/guest-access-policy";

export type AdminGuestRosterSort = "name" | "name-desc" | "status" | "newest";

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
  updatedAt: string;
  updatedAtLabel: string;
};

export type LoadAdminGuestRosterResult = {
  error: object | null;
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
  updated_at: string;
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
  "id, full_name, email, phone, notes, guest_kind, invited_guest_id, invite_status, rsvp_managed, rsvp_status, sms_opt_in, plus_one_allowed, created_at, updated_at";
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
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
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
      extraGuests: 0,
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
      canSave: true,
      email: guest.email,
      fullName: guest.full_name,
      guestKind: guest.guest_kind,
      guestKindLabel: getGuestKindLabel(guest.guest_kind),
      hasActiveToken: guestsWithActiveTokens.has(guest.id),
      id: guest.id,
      inviteAccessScope: getInviteAccessScopeForGuestKind(guest.guest_kind),
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
      updatedAt: guest.updated_at,
      updatedAtLabel: formatRsvpSubmittedAt(guest.updated_at) ?? "—",
    };
  });
}

async function loadRosterRelated(supabase: SupabaseClient, weddingId: string, table: "guests" | "invite_tokens" | "rsvp_responses", select: string, column: string, ids: string[]) {
  const data: unknown[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 200) {
      let query = supabase.from(table).select(select).eq("wedding_id", weddingId)
        .in(column, ids.slice(start, start + 100)).order("id").range(offset, offset + 199);
      if (table === "invite_tokens") query = query.eq("is_active", true);
      const page = await query;
      if (page.error) return { data: [], error: page.error };
      data.push(...(page.data ?? []));
      if (!page.data || page.data.length < 200) break;
    }
  }
  return { data, error: null };
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
  // Load before filtering: dietary fields and +1 details live in RSVP responses.
  // Stable, bounded pages avoid silently truncating the roster at 500 Guests.
  const guestRows: AdminGuestRosterGuestRow[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("guests").select(GUEST_SELECT)
      .eq("wedding_id", weddingId).is("deleted_at", null)
      .order("id").range(offset, offset + 199);
    if (error) return { error, rows: [] };
    if (!Array.isArray(data) || !data.every(isAdminGuestRosterGuestRow)) {
      return { error: new Error("Invalid guest roster data"), rows: [] };
    }
    guestRows.push(...data);
    if (data.length < 200) break;
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
        loadRosterRelated(supabase, weddingId, "invite_tokens", "guest_id", "guest_id", guestIds),
        loadRosterRelated(supabase, weddingId, "rsvp_responses", RSVP_RESPONSE_SELECT, "guest_id", rsvpGuestIds),
        loadRosterRelated(supabase, weddingId, "guests", "id, full_name", "id", invitedGuestIds),
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
    rows: buildAdminGuestRosterRows({
      activeInviteTokenRows: activeTokensResult.data ?? [],
      guestRows,
      rsvpResponses: rsvpResponsesResult.data ?? [],
      tiedInvitedGuests: tiedInvitedGuestsResult.data ?? [],
    }).filter((row) => matchesAdminGuestRosterFilters(row, filters)).sort((left, right) => {
      if (filters.sort === "newest") return right.updatedAt.localeCompare(left.updatedAt);
      if (filters.sort === "status") return `${left.rsvpStatus}-${left.inviteStatus}-${left.fullName}`.localeCompare(`${right.rsvpStatus}-${right.inviteStatus}-${right.fullName}`, "sv");
      return (filters.sort === "name-desc" ? -1 : 1) * left.fullName.localeCompare(right.fullName, "sv");
    }),
  };
}
