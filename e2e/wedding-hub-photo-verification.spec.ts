import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { verifyStoredObject } from "../lib/wedding-hub-photo-verification";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const originalFetch = globalThis.fetch;

test.afterEach(() => { globalThis.fetch = originalFetch; });

function harness({ size = 50 * 1024 * 1024, header = PNG, status = 200, failRange = false, chunkSize = 1024, failRead = false } = {}) {
  let consumed = 0;
  let cancelled = 0;
  let failedResponseCancelled = false;
  const ranges: (string | null)[] = [];
  const signals: AbortSignal[] = [];
  const supabase = createClient("http://storage.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/info/")) return Response.json({ size });
      if (url.includes("/sign/")) return Response.json({ signedURL: "/object/test-photo" });
      throw new Error("Unexpected Storage metadata request");
    } },
  });
  globalThis.fetch = async (_input, init) => {
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (init?.signal) signals.push(init.signal);
    const range = new Headers(init?.headers).get("range");
    ranges.push(range);
    if (failRange && range) {
      return new Response(new ReadableStream({ cancel() { failedResponseCancelled = true; } }), { status: 416 });
    }
    let offset = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (failRead) { controller.error(new Error("stream interrupted")); return; }
        if (offset >= size) { controller.close(); return; }
        const bytes = new Uint8Array(Math.min(chunkSize, size - offset));
        if (offset === 0) bytes.set(header.subarray(0, bytes.length));
        offset += bytes.length;
        consumed += bytes.length;
        controller.enqueue(bytes);
      },
      cancel() { cancelled += 1; },
    }, { highWaterMark: 0 }), { status });
  };
  return { supabase, stats: () => ({ consumed, cancelled, ranges, failedResponseCancelled }), signals, size };
}

for (const status of [200, 206]) {
  test(`reads bounded prefix and cancels remainder on ${status}`, async () => {
    const fake = harness({ status });
    const result = await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime: "image/png", declaredSize: fake.size });
    expect(result).toMatchObject({ ok: true, mimeType: "image/png", sizeBytes: fake.size });
    expect(fake.stats()).toMatchObject({ consumed: 8192, cancelled: 1, ranges: ["bytes=0-8191"] });
    expect(fake.signals.every(signal => signal.aborted)).toBe(true);
  });
}

test("range failure cancels error body; fallback 200 still bounded", async () => {
  const fake = harness({ failRange: true });
  expect(await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime: "image/png", declaredSize: fake.size })).toMatchObject({ ok: true });
  expect(fake.stats()).toEqual({ consumed: 8192, cancelled: 1, failedResponseCancelled: true, ranges: ["bytes=0-8191", null] });
});

test("oversized stream chunk is not followed by another read", async () => {
  const fake = harness({ chunkSize: 64 * 1024 });
  expect(await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime: "image/png", declaredSize: fake.size })).toMatchObject({ ok: true });
  expect(fake.stats()).toMatchObject({ consumed: 64 * 1024, cancelled: 1 });
});

for (const [label, header, declaredMime, reason] of [
  ["invalid magic", new Uint8Array([1, 2, 3]), "image/png", "invalid_magic"],
  ["mismatched MIME", PNG, "image/jpeg", "mime_mismatch"],
] as const) {
  test(`rejects ${label} without consuming whole object`, async () => {
    const fake = harness({ header });
    expect(await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime, declaredSize: fake.size })).toMatchObject({ ok: false, reason });
    expect(fake.stats()).toMatchObject({ consumed: 8192, cancelled: 1 });
  });
}

test("rejects storage-observed size mismatch before fetching body", async () => {
  const fake = harness();
  expect(await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime: "image/png", declaredSize: 100 })).toMatchObject({ ok: false, reason: "size_mismatch" });
  expect(fake.stats().ranges).toEqual([]);
});

test("interrupted header fails closed", async () => {
  const fake = harness({ failRead: true });
  expect(await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime: "image/png", declaredSize: fake.size })).toMatchObject({ ok: false, reason: "header_fetch_failed" });
});

test("accepts HEIC brand with generic mif1 compatibility", async () => {
  const header = Buffer.from("000000186674797068656963000000006d69663168656963", "hex");
  const fake = harness({ header, size: header.length });
  expect(await verifyStoredObject({ supabase: fake.supabase, path: "photo", declaredMime: "image/heic", declaredSize: fake.size })).toMatchObject({ ok: true, mimeType: "image/heic" });
  expect(fake.stats().ranges).toEqual([null]);
});
