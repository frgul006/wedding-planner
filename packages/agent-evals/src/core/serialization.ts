/** Stable, lossless JSON for saved evidence and request grouping. No vendor/runtime imports. */

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      return item;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      return item;
    }
    if (typeof item !== 'object') {
      throw new Error('Evidence must contain only JSON values');
    }
    if (ancestors.has(item)) {
      throw new Error('Evidence cannot contain cycles');
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        return item.map(normalize);
      }
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new Error('Evidence must contain plain JSON objects');
      }
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    } finally {
      ancestors.delete(item);
    }
  };
  return JSON.stringify(normalize(value));
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function immutableCopy<T>(value: T): T {
  const copied: T = JSON.parse(canonicalJson(value));
  const freeze = (item: unknown) => {
    if (item && typeof item === 'object') {
      for (const value of Object.values(item)) {
        freeze(value);
      }
      Object.freeze(item);
    }
  };
  freeze(copied);
  return copied;
}
