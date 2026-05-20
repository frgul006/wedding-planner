import { getSafeHttpUrl } from "@/lib/safe-url";

export const WEDDING_SETTINGS_DISPLAY_FALLBACK = "Kommer snart";

const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";
const PARTNER_NAME_PLACEHOLDERS = {
  one: "Partner 1",
  two: "Partner 2",
} as const;

const weddingDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: STOCKHOLM_TIME_ZONE,
});

const coverDatePartsFormatter = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "numeric",
  timeZone: STOCKHOLM_TIME_ZONE,
});

const coverTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: STOCKHOLM_TIME_ZONE,
});

const hubDateBadgeFormatter = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: STOCKHOLM_TIME_ZONE,
});

const swedishShortMonths = [
  "jan",
  "feb",
  "mars",
  "apr",
  "maj",
  "juni",
  "juli",
  "aug",
  "sept",
  "okt",
  "nov",
  "dec",
] as const;

export type PublicPartnerNames = {
  displayName: string;
  hasExplicitPartnerOneName: boolean;
  hasExplicitPartnerTwoName: boolean;
  partnerOneName: string;
  partnerTwoName: string;
};

export type WeddingCoverDateTime = {
  dateText: string;
  dayText: string | null;
  monthText: string | null;
  timeText: string | null;
};

export type GuestFacingWeddingSettingsInput = {
  google_maps_url: string | null;
  partner_one_name: string | null;
  partner_two_name: string | null;
  spotify_playlist_url: string | null;
  venue_address: string | null;
  venue_area: string | null;
  venue_name: string | null;
  wedding_date: string | null;
};

export type GuestFacingWeddingSettingsDisplay = {
  coupleMark: string;
  coverDateTime: WeddingCoverDateTime;
  coverVenueArea: string;
  coverVenueName: string;
  mapsUrl: string | null;
  partnerNames: PublicPartnerNames;
  spotifyUrl: string | null;
  weddingDate: string;
};

export type WeddingHubDisplayInput = {
  name: string;
  partner_one_name?: string | null;
  partner_two_name?: string | null;
  spotify_playlist_url: string | null;
  wedding_date: string | null;
};

export type WeddingHubDisplay = {
  dateBadge: string;
  monogram: string;
  spotifyEnabled: boolean;
  spotifyUrl: string | null;
};

function cleanPublicText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getWeddingSettingsDisplayText(
  value: string | null,
  fallback = WEDDING_SETTINGS_DISPLAY_FALLBACK,
) {
  const text = value?.trim();
  return text ? text : fallback;
}

export function getSafeWeddingSettingsUrl(value: string | null) {
  return getSafeHttpUrl(value);
}

export function formatWeddingSettingsDate(
  value: string | null,
  { fallback = WEDDING_SETTINGS_DISPLAY_FALLBACK }: { fallback?: string } = {},
) {
  const date = parseDate(value);
  return date ? weddingDateFormatter.format(date) : fallback;
}

export function formatWeddingCoverDateTime(
  value: string | null,
): WeddingCoverDateTime {
  const date = parseDate(value);

  if (!date) {
    return {
      dateText: WEDDING_SETTINGS_DISPLAY_FALLBACK,
      dayText: null,
      monthText: null,
      timeText: null,
    };
  }

  const parts = coverDatePartsFormatter.formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const monthText = Number.isInteger(month) ? swedishShortMonths[month - 1] : null;

  if (!day || !monthText) {
    return {
      dateText: WEDDING_SETTINGS_DISPLAY_FALLBACK,
      dayText: null,
      monthText: null,
      timeText: null,
    };
  }

  return {
    dateText: `${day} ${monthText}`,
    dayText: day,
    monthText,
    timeText: `kl. ${coverTimeFormatter.format(date)}`,
  };
}

export function formatWeddingHubDateBadge(value: string | null) {
  const date = parseDate(value);

  if (!date) {
    return "BRÖLLOPSHUBB";
  }

  return hubDateBadgeFormatter
    .format(date)
    .replace(".", "")
    .toLocaleUpperCase("sv-SE");
}

export function getPublicPartnerNames({
  partner_one_name: partnerOneName,
  partner_two_name: partnerTwoName,
}: {
  partner_one_name: string | null;
  partner_two_name: string | null;
}): PublicPartnerNames {
  const explicitPartnerOneName = cleanPublicText(partnerOneName);
  const explicitPartnerTwoName = cleanPublicText(partnerTwoName);
  const publicPartnerOneName = explicitPartnerOneName ?? PARTNER_NAME_PLACEHOLDERS.one;
  const publicPartnerTwoName = explicitPartnerTwoName ?? PARTNER_NAME_PLACEHOLDERS.two;

  return {
    displayName: `${publicPartnerOneName} & ${publicPartnerTwoName}`,
    hasExplicitPartnerOneName: Boolean(explicitPartnerOneName),
    hasExplicitPartnerTwoName: Boolean(explicitPartnerTwoName),
    partnerOneName: publicPartnerOneName,
    partnerTwoName: publicPartnerTwoName,
  };
}

export function getCoupleMark(partnerNames: PublicPartnerNames) {
  if (
    !partnerNames.hasExplicitPartnerOneName ||
    !partnerNames.hasExplicitPartnerTwoName
  ) {
    return "♡";
  }

  return `${partnerNames.partnerOneName.charAt(0)} & ${partnerNames.partnerTwoName.charAt(0)}`.toUpperCase();
}

function getNameBasedMonogram(name: string) {
  const cleanedName = name.replace(/<3|&|\+|och|and/gi, " ");
  const parts = cleanedName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0]?.charAt(0).toUpperCase() ?? "W";
  const second =
    parts.length > 1 ? parts[parts.length - 1]?.charAt(0).toUpperCase() : "H";

  return `${first}&${second}`;
}

export function getWeddingHubMonogram({
  name,
  partner_one_name: partnerOneName = null,
  partner_two_name: partnerTwoName = null,
}: Pick<WeddingHubDisplayInput, "name" | "partner_one_name" | "partner_two_name">) {
  const partnerNames = getPublicPartnerNames({
    partner_one_name: partnerOneName,
    partner_two_name: partnerTwoName,
  });

  if (
    partnerNames.hasExplicitPartnerOneName &&
    partnerNames.hasExplicitPartnerTwoName
  ) {
    return getCoupleMark(partnerNames);
  }

  return getNameBasedMonogram(name);
}

export function getInviteSupportDisplayName({
  partner_one_name: partnerOneName,
  partner_two_name: partnerTwoName,
}: {
  partner_one_name: string | null;
  partner_two_name: string | null;
}) {
  const firstName = cleanPublicText(partnerOneName);
  const secondName = cleanPublicText(partnerTwoName);

  if (!firstName || !secondName) {
    return null;
  }

  return `${firstName} & ${secondName}`;
}

export function getInviteSupportFooterMark(displayName: string | null) {
  if (!displayName) {
    return null;
  }

  const parts = displayName
    .split("&")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 2) {
    return displayName;
  }

  return `${parts[0].charAt(0)} & ${parts[1].charAt(0)}`.toUpperCase();
}

export function getGuestFacingWeddingSettingsDisplay(
  settings: GuestFacingWeddingSettingsInput,
): GuestFacingWeddingSettingsDisplay {
  const partnerNames = getPublicPartnerNames(settings);

  return {
    coupleMark: getCoupleMark(partnerNames),
    coverDateTime: formatWeddingCoverDateTime(settings.wedding_date),
    coverVenueArea: getWeddingSettingsDisplayText(
      settings.venue_area ?? settings.venue_address,
    ),
    coverVenueName: getWeddingSettingsDisplayText(settings.venue_name),
    mapsUrl: getSafeWeddingSettingsUrl(settings.google_maps_url),
    partnerNames,
    spotifyUrl: getSafeWeddingSettingsUrl(settings.spotify_playlist_url),
    weddingDate: formatWeddingSettingsDate(settings.wedding_date),
  };
}

export function getWeddingHubDisplay(
  wedding: WeddingHubDisplayInput,
): WeddingHubDisplay {
  const spotifyUrl = getSafeWeddingSettingsUrl(wedding.spotify_playlist_url);

  return {
    dateBadge: formatWeddingHubDateBadge(wedding.wedding_date),
    monogram: getWeddingHubMonogram(wedding),
    spotifyEnabled: Boolean(spotifyUrl),
    spotifyUrl,
  };
}
