import type { SupabaseClient } from "@supabase/supabase-js";

import { isGuestKind, type GuestKind } from "@/lib/guest-access-policy";
import { MESSAGE_AUDIENCES, type MessageAudience } from "@/lib/message-audience";
import { isE164PhoneNumber } from "@/lib/phone";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type { GuestKind } from "@/lib/guest-access-policy";
export type MessageRsvpAudience = Exclude<MessageAudience, "all">;

export type MessageTargetGuestRow = {
  deleted_at: string | null;
  full_name: string;
  guest_kind: GuestKind;
  id: string;
  invited_guest_id: string | null;
  phone: string | null;
  rsvp_status: string;
  sms_opt_in: boolean;
  sms_opted_out_at: string | null;
};

export type MessageTarget = {
  audienceRsvpStatus: MessageRsvpAudience | null;
  fullName: string;
  guestId: string;
  guestKind: GuestKind;
  phone: string;
};

export type LoadMessageTargetsResult =
  | { error: null; targets: MessageTarget[] }
  | { error: unknown; targets: [] };

export type SelectedMessageTargetExclusionReason =
  | "not-found"
  | "archived"
  | "missing-phone"
  | "invalid-phone"
  | "no-sms-consent"
  | "sms-opted-out";

export type SelectedMessageTargetExcludedGuest = {
  fullName: string | null;
  guestId: string;
  guestKind: GuestKind | null;
  phone: string | null;
  reason: SelectedMessageTargetExclusionReason;
};

export type SelectedMessageTargetsPreview = {
  eligibleTargets: MessageTarget[];
  excludedGuests: SelectedMessageTargetExcludedGuest[];
  selectedGuestIds: string[];
};

export type LoadSelectedMessageTargetsPreviewResult =
  | { error: null; preview: SelectedMessageTargetsPreview }
  | { error: unknown; preview: null };

export const SELECTED_MESSAGE_TARGET_EXCLUSION_LABELS: Record<
  SelectedMessageTargetExclusionReason,
  string
> = {
  archived: "Arkiverad Gäst",
  "invalid-phone": "Telefonnummer är inte i E.164-format",
  "missing-phone": "Telefonnummer saknas",
  "no-sms-consent": "SMS-samtycke saknas",
  "not-found": "Hittades inte för detta Wedding",
  "sms-opted-out": "Har valt bort SMS",
};

const MESSAGE_TARGET_GUEST_SELECT =
  "id, full_name, guest_kind, invited_guest_id, phone, rsvp_status, sms_opt_in, sms_opted_out_at, deleted_at";

const EMPTY_AUDIENCE_COUNTS: Record<MessageAudience, number> = {
  all: 0,
  "rsvp maybe": 0,
  "rsvp no": 0,
  "rsvp yes": 0,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMessageRsvpAudience(value: unknown): value is MessageRsvpAudience {
  return value === "rsvp yes" || value === "rsvp no" || value === "rsvp maybe";
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function parseSelectedGuestIds(value: string | string[] | FormDataEntryValue | null | undefined) {
  const rawValues = Array.isArray(value) ? value : [value];
  const selectedGuestIds: string[] = [];
  const seenIds = new Set<string>();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }

    for (const part of rawValue.split(",")) {
      const guestId = part.trim();
      if (!guestId || seenIds.has(guestId)) {
        continue;
      }

      seenIds.add(guestId);
      selectedGuestIds.push(guestId);
    }
  }

  return selectedGuestIds;
}

export function isMessageTargetGuestRow(value: unknown): value is MessageTargetGuestRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string" &&
    isGuestKind(value.guest_kind) &&
    isNullableString(value.invited_guest_id) &&
    isNullableString(value.phone) &&
    typeof value.rsvp_status === "string" &&
    typeof value.sms_opt_in === "boolean" &&
    isNullableString(value.sms_opted_out_at) &&
    isNullableString(value.deleted_at)
  );
}

function isActiveGuest(row: MessageTargetGuestRow) {
  return row.deleted_at === null;
}

function getInvitedGuestRsvpStatuses(rows: MessageTargetGuestRow[]) {
  return rows.reduce<Map<string, MessageRsvpAudience>>((statuses, row) => {
    if (row.guest_kind === "invited" && isActiveGuest(row) && isMessageRsvpAudience(row.rsvp_status)) {
      statuses.set(row.id, row.rsvp_status);
    }

    return statuses;
  }, new Map());
}

function getTargetAudienceRsvpStatus(
  row: MessageTargetGuestRow,
  invitedGuestRsvpStatuses: Map<string, MessageRsvpAudience>,
) {
  if (row.guest_kind === "plus_one") {
    return row.invited_guest_id ? (invitedGuestRsvpStatuses.get(row.invited_guest_id) ?? null) : null;
  }

  return isMessageRsvpAudience(row.rsvp_status) ? row.rsvp_status : null;
}

function isEligibleMessageTargetGuestRow(
  row: MessageTargetGuestRow,
): row is MessageTargetGuestRow & { phone: string } {
  return (
    isActiveGuest(row) &&
    row.sms_opt_in &&
    !row.sms_opted_out_at &&
    typeof row.phone === "string" &&
    isE164PhoneNumber(row.phone)
  );
}

function getSelectedMessageTargetExclusionReason(
  row: MessageTargetGuestRow,
): SelectedMessageTargetExclusionReason | null {
  if (!isActiveGuest(row)) {
    return "archived";
  }

  if (typeof row.phone !== "string" || row.phone.trim().length === 0) {
    return "missing-phone";
  }

  if (!isE164PhoneNumber(row.phone)) {
    return "invalid-phone";
  }

  if (!row.sms_opt_in) {
    return "no-sms-consent";
  }

  if (row.sms_opted_out_at) {
    return "sms-opted-out";
  }

  return null;
}

function toMessageTarget(
  row: MessageTargetGuestRow & { phone: string },
  invitedGuestRsvpStatuses: Map<string, MessageRsvpAudience>,
): MessageTarget {
  return {
    audienceRsvpStatus: getTargetAudienceRsvpStatus(row, invitedGuestRsvpStatuses),
    fullName: row.full_name,
    guestId: row.id,
    guestKind: row.guest_kind,
    phone: row.phone,
  };
}

export function selectEligibleMessageTargets(rows: MessageTargetGuestRow[]) {
  const invitedGuestRsvpStatuses = getInvitedGuestRsvpStatuses(rows);

  return rows
    .filter(isEligibleMessageTargetGuestRow)
    .map<MessageTarget>((row) => toMessageTarget(row, invitedGuestRsvpStatuses))
    .sort(
      (left, right) =>
        left.fullName.localeCompare(right.fullName, "sv-SE", { sensitivity: "base" }) ||
        left.guestId.localeCompare(right.guestId),
    );
}

export function selectSelectedMessageTargetsPreview({
  rows,
  selectedGuestIds,
}: {
  rows: MessageTargetGuestRow[];
  selectedGuestIds: string[];
}): SelectedMessageTargetsPreview {
  const parsedSelectedGuestIds = parseSelectedGuestIds(selectedGuestIds);
  const rowsByGuestId = new Map(rows.map((row) => [row.id, row]));
  const invitedGuestRsvpStatuses = getInvitedGuestRsvpStatuses(rows);
  const eligibleTargets: MessageTarget[] = [];
  const excludedGuests: SelectedMessageTargetExcludedGuest[] = [];

  for (const guestId of parsedSelectedGuestIds) {
    const row = rowsByGuestId.get(guestId);

    if (!row) {
      excludedGuests.push({
        fullName: null,
        guestId,
        guestKind: null,
        phone: null,
        reason: "not-found",
      });
      continue;
    }

    const exclusionReason = getSelectedMessageTargetExclusionReason(row);
    if (exclusionReason) {
      excludedGuests.push({
        fullName: row.full_name,
        guestId,
        guestKind: row.guest_kind,
        phone: row.phone,
        reason: exclusionReason,
      });
      continue;
    }

    if (typeof row.phone !== "string") {
      continue;
    }

    eligibleTargets.push(toMessageTarget({ ...row, phone: row.phone }, invitedGuestRsvpStatuses));
  }

  return {
    eligibleTargets,
    excludedGuests,
    selectedGuestIds: parsedSelectedGuestIds,
  };
}

export function filterMessageTargetsByAudience(targets: MessageTarget[], audience: MessageAudience) {
  if (audience === "all") {
    return targets;
  }

  return targets.filter((target) => target.audienceRsvpStatus === audience);
}

export function countMessageTargetsByAudience(targets: MessageTarget[]) {
  return MESSAGE_AUDIENCES.reduce<Record<MessageAudience, number>>((counts, audience) => {
    counts[audience] = filterMessageTargetsByAudience(targets, audience).length;
    return counts;
  }, { ...EMPTY_AUDIENCE_COUNTS });
}

export async function loadMessageTargets({
  supabase,
  weddingId,
}: {
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<LoadMessageTargetsResult> {
  const { data, error } = await supabase
    .from("guests")
    .select(MESSAGE_TARGET_GUEST_SELECT)
    .eq("wedding_id", weddingId)
    .order("full_name", { ascending: true });

  if (error) {
    return { error, targets: [] };
  }

  return {
    error: null,
    targets: selectEligibleMessageTargets((data ?? []).filter(isMessageTargetGuestRow)),
  };
}

export async function loadSelectedMessageTargetsPreview({
  selectedGuestIds,
  supabase,
  weddingId,
}: {
  selectedGuestIds: string[];
  supabase: SupabaseClient;
  weddingId: string;
}): Promise<LoadSelectedMessageTargetsPreviewResult> {
  const parsedSelectedGuestIds = parseSelectedGuestIds(selectedGuestIds);
  const validSelectedGuestIds = parsedSelectedGuestIds.filter(isUuid);

  if (validSelectedGuestIds.length === 0) {
    return {
      error: null,
      preview: selectSelectedMessageTargetsPreview({ rows: [], selectedGuestIds: parsedSelectedGuestIds }),
    };
  }

  const { data, error } = await supabase
    .from("guests")
    .select(MESSAGE_TARGET_GUEST_SELECT)
    .eq("wedding_id", weddingId)
    .in("id", validSelectedGuestIds);

  if (error) {
    return { error, preview: null };
  }

  const selectedRows = (data ?? []).filter(isMessageTargetGuestRow);
  const selectedRowIds = new Set(selectedRows.map((row) => row.id));
  const parentGuestIds = selectedRows
    .flatMap((row) => {
      if (row.guest_kind !== "plus_one" || typeof row.invited_guest_id !== "string") {
        return [];
      }

      return isUuid(row.invited_guest_id) ? [row.invited_guest_id] : [];
    })
    .filter((guestId) => !selectedRowIds.has(guestId));
  const uniqueParentGuestIds = Array.from(new Set(parentGuestIds));
  let rowsForPreview = selectedRows;

  if (uniqueParentGuestIds.length > 0) {
    const { data: parentData, error: parentError } = await supabase
      .from("guests")
      .select(MESSAGE_TARGET_GUEST_SELECT)
      .eq("wedding_id", weddingId)
      .in("id", uniqueParentGuestIds);

    if (parentError) {
      return { error: parentError, preview: null };
    }

    rowsForPreview = [...selectedRows, ...(parentData ?? []).filter(isMessageTargetGuestRow)];
  }

  return {
    error: null,
    preview: selectSelectedMessageTargetsPreview({
      rows: rowsForPreview,
      selectedGuestIds: parsedSelectedGuestIds,
    }),
  };
}
