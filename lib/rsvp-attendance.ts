export const RSVP_ATTENDANCE = {
  maybe: "maybe",
  no: "no",
  yes: "yes",
} as const;

export const RSVP_ATTENDANCES = [
  RSVP_ATTENDANCE.yes,
  RSVP_ATTENDANCE.no,
  RSVP_ATTENDANCE.maybe,
] as const;

export type RsvpAttendance = (typeof RSVP_ATTENDANCES)[number];

export function isRsvpAttendance(value: unknown): value is RsvpAttendance {
  return (
    typeof value === "string" &&
    RSVP_ATTENDANCES.some((attendance) => attendance === value)
  );
}
