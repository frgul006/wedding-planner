import { isRecord } from "@/lib/type-guards";

export type HubPhotoCursor = {
  createdAt: string;
  id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/;

export function encodeHubPhotoCursor(cursor: HubPhotoCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor })).toString("base64url");
}

export function parseHubPhotoCursor(value: string): HubPhotoCursor | null {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isRecord(parsed) || parsed.v !== 1 ||
      typeof parsed.id !== "string" || !UUID.test(parsed.id) ||
      typeof parsed.createdAt !== "string" || !UTC_TIMESTAMP.test(parsed.createdAt)
    ) return null;

    const date = new Date(parsed.createdAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.createdAt.slice(0, 10)) {
      return null;
    }

    // Keep Postgres microseconds: Date.toISOString() would truncate the page boundary.
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
