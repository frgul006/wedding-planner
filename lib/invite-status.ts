import { RSVP_ATTENDANCE, type RsvpAttendance } from "./rsvp-attendance";

export type RsvpInviteStatus = `rsvp ${RsvpAttendance}`;

export const INVITE_OPENED_STATUS = {
  notReplied: "not replied",
  opened: "opened",
} as const;

export const RSVP_STATUS = {
  notReplied: "not replied",
  rsvpMaybe: `rsvp ${RSVP_ATTENDANCE.maybe}`,
  rsvpNo: `rsvp ${RSVP_ATTENDANCE.no}`,
  rsvpYes: `rsvp ${RSVP_ATTENDANCE.yes}`,
} as const satisfies Record<
  string,
  "not replied" | RsvpInviteStatus
>;

export const GUEST_STATUS = {
  ...INVITE_OPENED_STATUS,
  rsvpMaybe: RSVP_STATUS.rsvpMaybe,
  rsvpNo: RSVP_STATUS.rsvpNo,
  rsvpYes: RSVP_STATUS.rsvpYes,
} as const;

export const INVITE_STATUSES = [
  GUEST_STATUS.notReplied,
  GUEST_STATUS.opened,
  GUEST_STATUS.rsvpYes,
  GUEST_STATUS.rsvpNo,
  GUEST_STATUS.rsvpMaybe,
] as const;

export const INVITE_OPENED_STATUSES = [
  INVITE_OPENED_STATUS.notReplied,
  INVITE_OPENED_STATUS.opened,
] as const;

export const RSVP_STATUSES = [
  RSVP_STATUS.notReplied,
  RSVP_STATUS.rsvpYes,
  RSVP_STATUS.rsvpNo,
  RSVP_STATUS.rsvpMaybe,
] as const;

// Back-compat name for the admin-visible Guest status vocabulary.
export const INVITE_STATUS = GUEST_STATUS;

export type InviteOpenedStatus = (typeof INVITE_OPENED_STATUSES)[number];
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export function inviteStatusForRsvpAttendance(
  attendance: RsvpAttendance,
): RsvpInviteStatus {
  return `rsvp ${attendance}`;
}

export function rsvpStatusForRsvpAttendance(
  attendance: RsvpAttendance,
): RsvpInviteStatus {
  return inviteStatusForRsvpAttendance(attendance);
}

export function isInviteOpenedStatus(value: unknown): value is InviteOpenedStatus {
  return (
    typeof value === "string" &&
    INVITE_OPENED_STATUSES.some((status) => status === value)
  );
}

export function isRsvpStatus(value: unknown): value is RsvpStatus {
  return (
    typeof value === "string" && RSVP_STATUSES.some((status) => status === value)
  );
}

export function isInviteStatus(value: unknown): value is InviteStatus {
  return (
    typeof value === "string" && INVITE_STATUSES.some((status) => status === value)
  );
}

