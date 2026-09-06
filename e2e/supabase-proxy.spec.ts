import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";

import { proxy } from "../proxy";

const originalFetch = globalThis.fetch;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseUrl = "https://proxy-test.supabase.co";
const sessionCookieName = "sb-proxy-test-auth-token";
const user = {
  id: "00000000-0000-0000-0000-000000000002",
  aud: "authenticated",
  role: "authenticated",
  email: "proxy-test@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function createSession(expiresAt: number, refreshToken: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt })}.test-signature`,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_proxy-test";
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  }

  if (originalSupabaseKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalSupabaseKey;
  }
});

const scenarios: {
  name: string;
  path: string;
  activeAdmin: boolean;
  redirect: string | null;
  revoked?: boolean;
}[] = [
  {
    name: "protected pages",
    path: "/admin/guests",
    activeAdmin: true,
    redirect: null,
  },
  {
    name: "signed-in login redirects",
    path: "/admin/login",
    activeAdmin: true,
    redirect: "/admin",
  },
  {
    name: "unauthorized redirects",
    path: "/admin/guests",
    activeAdmin: false,
    redirect: "/admin/unauthorized",
  },
  {
    name: "unauthorized login redirects",
    path: "/admin/login",
    activeAdmin: false,
    redirect: "/admin/unauthorized",
  },
  {
    name: "session revocation after a token refresh",
    path: "/admin/guests?page=2",
    activeAdmin: false,
    redirect: "/admin/login?next=%2Fadmin%2Fguests%3Fpage%3D2",
    revoked: true,
  },
];

for (const scenario of scenarios) {
  test(`preserves session cookies and cache headers on ${scenario.name}`, async () => {
    const expiredSession = createSession(1, "expired-refresh-token");
    const refreshedSession = createSession(
      Math.floor(Date.now() / 1000) + 3600,
      "refreshed-token",
    );
    let refreshCount = 0;

    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));

      if (url.origin !== supabaseUrl) {
        throw new Error(`Unexpected request origin: ${url.origin}`);
      }

      if (url.pathname === "/auth/v1/token") {
        refreshCount += 1;
        return Response.json(refreshedSession);
      }

      if (url.pathname === "/auth/v1/user") {
        if (scenario.revoked) {
          return Response.json(
            { code: "session_not_found", message: "Session has been revoked" },
            { status: 403, headers: { "x-supabase-api-version": "2024-01-01" } },
          );
        }

        return Response.json(user);
      }

      if (url.pathname === "/rest/v1/admin_profiles") {
        return Response.json(
          scenario.activeAdmin
            ? [{
                id: user.id,
                wedding_id: "00000000-0000-0000-0000-000000000001",
                is_active: true,
              }]
            : [],
        );
      }

      throw new Error(`Unexpected request path: ${url.pathname}`);
    };

    const request = new NextRequest(`http://localhost:3000${scenario.path}`, {
      headers: {
        cookie: `${sessionCookieName}=base64-${Buffer.from(JSON.stringify(expiredSession)).toString("base64url")}`,
      },
    });
    const response = await proxy(request);

    expect(refreshCount).toBe(1);
    expect(response.status).toBe(scenario.redirect ? 307 : 200);
    expect(response.headers.get("location")).toBe(
      scenario.redirect ? `http://localhost:3000${scenario.redirect}` : null,
    );
    expect(response.cookies.get(sessionCookieName)?.value).toBe(
      scenario.revoked
        ? ""
        : `base64-${Buffer.from(JSON.stringify(refreshedSession)).toString("base64url")}`,
    );
    if (scenario.revoked) {
      expect(response.cookies.get(sessionCookieName)?.maxAge).toBe(0);
    }
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");

    if (scenario.redirect) {
      expect(response.headers.has("x-middleware-next")).toBe(false);
      expect(response.headers.has("x-middleware-override-headers")).toBe(false);
    } else {
      expect(request.cookies.get(sessionCookieName)?.value).toBe(
        response.cookies.get(sessionCookieName)?.value,
      );
    }
  });
}
