const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";
const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const stockholmDateTimeLocalFormatter = new Intl.DateTimeFormat("sv-SE", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: STOCKHOLM_TIME_ZONE,
  year: "numeric",
});

type DateTimeLocalParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

function getFormattedParts(date: Date) {
  const parts = stockholmDateTimeLocalFormatter.formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function parseDateTimeLocalParts(value: string): DateTimeLocalParts | null {
  const match = value.match(DATE_TIME_LOCAL_PATTERN);

  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const parts = {
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    month: Number(monthText),
    year: Number(yearText),
  };
  const localAsUtc = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );

  if (
    localAsUtc.getUTCFullYear() !== parts.year ||
    localAsUtc.getUTCMonth() !== parts.month - 1 ||
    localAsUtc.getUTCDate() !== parts.day ||
    localAsUtc.getUTCHours() !== parts.hour ||
    localAsUtc.getUTCMinutes() !== parts.minute
  ) {
    return null;
  }

  return parts;
}

function getStockholmOffsetMs(date: Date) {
  const parts = getFormattedParts(date);
  const localAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );

  return localAsUtcMs - date.getTime();
}

function sameDateTimeLocalParts(date: Date, expected: DateTimeLocalParts) {
  const parts = getFormattedParts(date);

  return (
    Number(parts.year) === expected.year &&
    Number(parts.month) === expected.month &&
    Number(parts.day) === expected.day &&
    Number(parts.hour) === expected.hour &&
    Number(parts.minute) === expected.minute
  );
}

export function formatStockholmDateTimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = getFormattedParts(date);

  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) {
    return "";
  }

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function parseStockholmDateTimeLocal(value: string) {
  const expectedParts = parseDateTimeLocalParts(value);

  if (!expectedParts) {
    return null;
  }

  const localAsUtcMs = Date.UTC(
    expectedParts.year,
    expectedParts.month - 1,
    expectedParts.day,
    expectedParts.hour,
    expectedParts.minute,
  );
  let instantMs = localAsUtcMs;

  for (let index = 0; index < 3; index += 1) {
    instantMs = localAsUtcMs - getStockholmOffsetMs(new Date(instantMs));
  }

  const date = new Date(instantMs);

  if (!sameDateTimeLocalParts(date, expectedParts)) {
    return null;
  }

  return date.toISOString();
}
