import type { SupabaseClient } from "@supabase/supabase-js";

import { MESSAGE_AUDIENCES, type MessageAudience } from "@/lib/message-audience";
import { isE164PhoneNumber } from "@/lib/phone";
import { isNullableString, isRecord } from "@/lib/type-guards";

export type GuestKind = "invited" | "plus_one";
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

const MESSAGE_TARGET_GUEST_SELECT =
  "id, full_name, guest_kind, invited_guest_id, phone, rsvp_status, sms_opt_in, sms_opted_out_at, deleted_at";

const EMPTY_AUDIENCE_COUNTS: Record<MessageAudience, number> = {
  all: 0,
  "rsvp maybe": 0,
  "rsvp no": 0,
  "rsvp yes": 0,
};

function isGuestKind(value: unknown): value is GuestKind {
  return value === "invited" || value === "plus_one";
}

function isMessageRsvpAudience(value: unknown): value is MessageRsvpAudience {
  return value === "rsvp yes" || value === "rsvp no" || value === "rsvp maybe";
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

export function selectEligibleMessageTargets(rows: MessageTargetGuestRow[]) {
  const invitedGuestRsvpStatuses = getInvitedGuestRsvpStatuses(rows);

  return rows
    .filter(isEligibleMessageTargetGuestRow)
    .map<MessageTarget>((row) => ({
      audienceRsvpStatus: getTargetAudienceRsvpStatus(row, invitedGuestRsvpStatuses),
      fullName: row.full_name,
      guestId: row.id,
      guestKind: row.guest_kind,
      phone: row.phone,
    }))
    .sort((left, right) =>
      left.fullName.localeCompare(right.fullName, "sv-SE", { sensitivity: "base" }) ||
      left.guestId.localeCompare(right.guestId),
    );
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
