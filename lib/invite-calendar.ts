import type { GrantedInviteAccessWithRsvp, InviteWedding } from "@/lib/invite-access";
import { RSVP_ATTENDANCE } from "@/lib/rsvp-attendance";
import { getSafeHttpUrl } from "@/lib/safe-url";

export const CALENDAR_ACTION_LABEL = "Lägg till i kalender";

const ICS_PRODUCT_ID = "-//Wedding Planner//Invite Calendar Action//SV";
const ICS_LINE_LIMIT_BYTES = 75;
const textEncoder = new TextEncoder();

type CalendarDateRange = {
  end: Date;
  start: Date;
};

type CalendarWedding = Pick<
  InviteWedding,
  | "google_maps_url"
  | "name"
  | "venue_address"
  | "venue_area"
  | "venue_name"
  | "wedding_date"
  | "wedding_end_date"
>;

type CalendarAccess = Pick<
  GrantedInviteAccessWithRsvp,
  "accessScope" | "guestId" | "inviteTokenId" | "rsvpResponse" | "wedding" | "weddingId"
>;

export type InviteCalendarFileInput = {
  access: CalendarAccess;
  inviteUrl: string;
  now?: Date;
};

function parseCalendarDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getValidCalendarDateRange(
  wedding: Pick<CalendarWedding, "wedding_date" | "wedding_end_date">,
): CalendarDateRange | null {
  const start = parseCalendarDate(wedding.wedding_date);
  const end = parseCalendarDate(wedding.wedding_end_date);

  if (!start || !end || end <= start) {
    return null;
  }

  return { end, start };
}

export function isInviteCalendarEligible(access: CalendarAccess) {
  if (!getValidCalendarDateRange(access.wedding)) {
    return false;
  }

  if (access.accessScope === "scoped") {
    return true;
  }

  const attendance = access.rsvpResponse?.attendance;

  return attendance === RSVP_ATTENDANCE.yes || attendance === RSVP_ATTENDANCE.maybe;
}

export function getInvitePath(rawToken: string) {
  return `/invite/${encodeURIComponent(rawToken)}`;
}

export function getInviteCalendarHref(rawToken: string) {
  return `${getInvitePath(rawToken)}/calendar.ics`;
}

export function getInviteCalendarActionHref({
  access,
  rawToken,
}: {
  access: CalendarAccess;
  rawToken: string;
}) {
  return isInviteCalendarEligible(access) ? getInviteCalendarHref(rawToken) : null;
}

function cleanCalendarText(value: string | null) {
  const text = value?.trim().replace(/\s+/g, " ");

  return text ? text : null;
}

function getCalendarLocation(wedding: CalendarWedding) {
  const parts = [
    cleanCalendarText(wedding.venue_name),
    cleanCalendarText(wedding.venue_address),
    cleanCalendarText(wedding.venue_area),
  ];
  const uniqueParts = parts.filter(
    (part, index): part is string => Boolean(part) && parts.indexOf(part) === index,
  );

  return uniqueParts.length ? uniqueParts.join(", ") : null;
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string) {
  let folded = "";
  let currentLine = "";
  let currentLineBytes = 0;

  for (const character of line) {
    const characterBytes = textEncoder.encode(character).byteLength;

    if (currentLineBytes > 0 && currentLineBytes + characterBytes > ICS_LINE_LIMIT_BYTES) {
      folded += `${currentLine}\r\n `;
      currentLine = character;
      currentLineBytes = characterBytes;
      continue;
    }

    currentLine += character;
    currentLineBytes += characterBytes;
  }

  return `${folded}${currentLine}`;
}

function textProperty(name: string, value: string) {
  return foldIcsLine(`${name}:${escapeIcsText(value)}`);
}

function rawProperty(name: string, value: string) {
  return foldIcsLine(`${name}:${value}`);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatIcsUtcDateTime(date: Date) {
  return `${date.getUTCFullYear()}${padDatePart(date.getUTCMonth() + 1)}${padDatePart(
    date.getUTCDate(),
  )}T${padDatePart(date.getUTCHours())}${padDatePart(date.getUTCMinutes())}${padDatePart(
    date.getUTCSeconds(),
  )}Z`;
}

function getInviteCalendarDescription({
  inviteUrl,
  mapsUrl,
}: {
  inviteUrl: string;
  mapsUrl: string | null;
}) {
  return [
    "Vi ser fram emot att fira tillsammans.",
    `Inbjudan: ${inviteUrl}`,
    mapsUrl ? `Karta: ${mapsUrl}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function getInviteCalendarUid(access: Pick<CalendarAccess, "inviteTokenId" | "weddingId">) {
  return `wedding-${access.weddingId}-${access.inviteTokenId}@wedding-planner`;
}

function addDisplayAlarm(lines: string[], trigger: "-P1D" | "-P7D", title: string) {
  lines.push(
    "BEGIN:VALARM",
    rawProperty("TRIGGER", trigger),
    rawProperty("ACTION", "DISPLAY"),
    textProperty("DESCRIPTION", `Påminnelse: ${title}`),
    "END:VALARM",
  );
}

export function createInviteCalendarFile({
  access,
  inviteUrl,
  now = new Date(),
}: InviteCalendarFileInput) {
  const dateRange = getValidCalendarDateRange(access.wedding);

  if (!dateRange || !isInviteCalendarEligible(access)) {
    return null;
  }

  const mapsUrl = getSafeHttpUrl(access.wedding.google_maps_url);
  const location = getCalendarLocation(access.wedding);
  const title = access.wedding.name;
  const lines = [
    "BEGIN:VCALENDAR",
    rawProperty("VERSION", "2.0"),
    rawProperty("PRODID", ICS_PRODUCT_ID),
    rawProperty("CALSCALE", "GREGORIAN"),
    rawProperty("METHOD", "PUBLISH"),
    "BEGIN:VEVENT",
    textProperty("UID", getInviteCalendarUid(access)),
    rawProperty("DTSTAMP", formatIcsUtcDateTime(now)),
    rawProperty("DTSTART", formatIcsUtcDateTime(dateRange.start)),
    rawProperty("DTEND", formatIcsUtcDateTime(dateRange.end)),
    textProperty("SUMMARY", title),
    textProperty("DESCRIPTION", getInviteCalendarDescription({ inviteUrl, mapsUrl })),
    rawProperty("URL", inviteUrl),
    rawProperty("TRANSP", "OPAQUE"),
    rawProperty("STATUS", "CONFIRMED"),
  ];

  if (location) {
    lines.push(textProperty("LOCATION", location));
  }

  addDisplayAlarm(lines, "-P7D", title);
  addDisplayAlarm(lines, "-P1D", title);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

export function getInviteCalendarFilename(weddingName: string) {
  const slug = weddingName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "brollop"}.ics`;
}
