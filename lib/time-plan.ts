import { isRecord } from "@/lib/type-guards";

export type WeddingTimePlanEntry = {
  time: string;
  label: string;
};

export type TimePlanTextParseResult =
  | {
      entries: WeddingTimePlanEntry[];
      status: "ok";
    }
  | {
      lineNumber: number;
      status: "error";
    };

const TIME_PLAN_LINE_PATTERN = /^(\d{1,2})[:.](\d{2})(?:\s*[-–—]\s*|\s+)(.+)$/;
const TIME_PLAN_TIME_PATTERN = /^(\d{1,2})[:.](\d{2})$/;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeParts(hourText: string, minuteText: string) {
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTime(value: string) {
  const match = value.trim().match(TIME_PLAN_TIME_PATTERN);

  if (!match) {
    return null;
  }

  const [, hourText, minuteText] = match;
  return normalizeTimeParts(hourText, minuteText);
}

export function parseTimePlanLine(line: string): WeddingTimePlanEntry | null {
  const text = line.trim();

  if (!text) {
    return null;
  }

  const match = text.match(TIME_PLAN_LINE_PATTERN);

  if (!match) {
    return null;
  }

  const [, rawHour, rawMinute, rawLabel] = match;
  const time = normalizeTimeParts(rawHour, rawMinute);
  const label = rawLabel.trim();

  if (!time || !label) {
    return null;
  }

  return { label, time };
}

export function timePlanEntryToLine(entry: WeddingTimePlanEntry) {
  return `${entry.time} - ${entry.label}`;
}

export function timePlanEntriesToText(entries: readonly WeddingTimePlanEntry[]) {
  return entries.map(timePlanEntryToLine).join("\n");
}

export function normalizeTimePlanEntries(value: unknown): WeddingTimePlanEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      const parsed = parseTimePlanLine(entry);
      return parsed ? [parsed] : [];
    }

    if (!isRecord(entry)) {
      return [];
    }

    const label = cleanText(entry.label);
    const time = normalizeTime(cleanText(entry.time));

    if (!label || !time) {
      return [];
    }

    return [{ label, time }];
  });
}

export function normalizeTimePlanLines(value: unknown) {
  return normalizeTimePlanEntries(value).map(timePlanEntryToLine);
}

export function parseTimePlanText(
  value: FormDataEntryValue | null,
): TimePlanTextParseResult {
  if (typeof value !== "string") {
    return { entries: [], status: "ok" };
  }

  const entries: WeddingTimePlanEntry[] = [];
  const lines = value.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }

    const parsed = parseTimePlanLine(line);

    if (!parsed) {
      return { lineNumber: index + 1, status: "error" };
    }

    entries.push(parsed);
  }

  return { entries, status: "ok" };
}
