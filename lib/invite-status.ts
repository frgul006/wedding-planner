import { RSVP_ATTENDANCE, type RsvpAttendance } from "./rsvp-attendance";

export type RsvpInviteStatus = `rsvp ${RsvpAttendance}`;

export const INVITE_STATUS = {
  notReplied: "not replied",
  opened: "opened",
  rsvpMaybe: `rsvp ${RSVP_ATTENDANCE.maybe}`,
  rsvpNo: `rsvp ${RSVP_ATTENDANCE.no}`,
  rsvpYes: `rsvp ${RSVP_ATTENDANCE.yes}`,
} as const satisfies Record<string, "not replied" | "opened" | RsvpInviteStatus>;

export const INVITE_STATUSES = [
  INVITE_STATUS.notReplied,
  INVITE_STATUS.opened,
  INVITE_STATUS.rsvpYes,
  INVITE_STATUS.rsvpNo,
  INVITE_STATUS.rsvpMaybe,
] as const;

export type InviteStatus = (typeof INVITE_STATUSES)[number];

export function inviteStatusForRsvpAttendance(
  attendance: RsvpAttendance,
): RsvpInviteStatus {
  return `rsvp ${attendance}`;
}

export function isInviteStatus(value: unknown): value is InviteStatus {
  return (
    typeof value === "string" &&
    INVITE_STATUSES.some((status) => status === value)
  );
}
