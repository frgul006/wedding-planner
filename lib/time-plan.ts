import { isRecord } from "@/lib/type-guards";

export type WeddingTimePlanEntry = {
  time: string;
  label: string;
};

const TIME_PLAN_LINE_PATTERN = /^([0-2]?\d[:.]\d{2})(?:\s*[-–—]\s*|\s+)(.+)$/;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTime(value: string) {
  return value.trim().replace(".", ":");
}

export function parseTimePlanLine(line: string): WeddingTimePlanEntry | null {
  const text = line.trim();

  if (!text) {
    return null;
  }

  const match = text.match(TIME_PLAN_LINE_PATTERN);

  if (!match) {
    return { time: "", label: text };
  }

  const [, rawTime, rawLabel] = match;
  const label = rawLabel.trim();

  if (!label) {
    return null;
  }

  return {
    label,
    time: normalizeTime(rawTime),
  };
}

export function timePlanEntryToLine(entry: WeddingTimePlanEntry) {
  return entry.time ? `${entry.time} - ${entry.label}` : entry.label;
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

    if (!label) {
      return [];
    }

    return [
      {
        label,
        time: normalizeTime(cleanText(entry.time)),
      },
    ];
  });
}

export function normalizeTimePlanLines(value: unknown) {
  return normalizeTimePlanEntries(value).map(timePlanEntryToLine);
}

export function parseTimePlanText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map(parseTimePlanLine)
    .filter((entry): entry is WeddingTimePlanEntry => entry !== null);
}
