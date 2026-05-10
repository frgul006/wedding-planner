import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

import { isRecord } from "@/lib/type-guards";

const GUEST_NAVIGATION_COOKIE_BYTES = 32;
export const GUEST_NAVIGATION_COOKIE_NAME = "wp_guest_navigation";
export const GUEST_NAVIGATION_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

type GuestNavigationSessionIdentity = {
  guestId: string;
  inviteTokenId: string;
  weddingId: string;
};

type GuestNavigationSessionCookie = {
  cookieValue: string;
  expiresAt: Date;
};

type GuestNavigationSessionRow = {
  id: string;
};

function isGuestNavigationSessionRow(value: unknown): value is GuestNavigationSessionRow {
  return isRecord(value) && typeof value.id === "string";
}

export function generateGuestNavigationCookieValue() {
  return randomBytes(GUEST_NAVIGATION_COOKIE_BYTES).toString("base64url");
}

export function hashGuestNavigationCookie(cookieValue: string) {
  return createHash("sha256").update(cookieValue, "utf8").digest("hex");
}

export function getGuestNavigationSessionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + GUEST_NAVIGATION_SESSION_MAX_AGE_SECONDS * 1_000);
}

export function getGuestNavigationCookieOptions(expiresAt: Date) {
  return {
    expires: expiresAt,
    httpOnly: true,
    maxAge: GUEST_NAVIGATION_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: true,
  };
}

export function getGuestNavigationCookieValue(request: NextRequest) {
  const value = request.cookies.get(GUEST_NAVIGATION_COOKIE_NAME)?.value;

  if (!value || value.length > 256) {
    return null;
  }

  return value;
}

export function setGuestNavigationCookie({
  cookieValue,
  expiresAt,
  response,
}: GuestNavigationSessionCookie & {
  response: NextResponse;
}) {
  response.cookies.set({
    name: GUEST_NAVIGATION_COOKIE_NAME,
    value: cookieValue,
    ...getGuestNavigationCookieOptions(expiresAt),
  });
}

export function getGuestNavigationSessionMetadata(request: NextRequest) {
  const userAgent = request.headers.get("user-agent")?.trim();

  if (!userAgent) {
    return null;
  }

  return { user_agent: userAgent };
}

async function findSessionByCookieHash({
  cookieHash,
  supabase,
}: {
  cookieHash: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from("guest_navigation_sessions")
    .select("id")
    .eq("cookie_hash", cookieHash)
    .maybeSingle();

  if (error) {
    console.error("Failed to look up guest navigation session", error);
    return null;
  }

  return isGuestNavigationSessionRow(data) ? data : null;
}

export async function createOrRefreshGuestNavigationSession({
  existingCookieValue,
  guestId,
  inviteTokenId,
  metadata,
  supabase,
  weddingId,
}: GuestNavigationSessionIdentity & {
  existingCookieValue: string | null;
  metadata: Record<string, string> | null;
  supabase: SupabaseClient;
}): Promise<GuestNavigationSessionCookie | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = getGuestNavigationSessionExpiresAt(now);
  const expiresAtIso = expiresAt.toISOString();
  const sessionPayload = {
    expires_at: expiresAtIso,
    guest_id: guestId,
    invite_token_id: inviteTokenId,
    is_anonymous: false,
    last_seen_at: nowIso,
    metadata,
    wedding_id: weddingId,
  };

  if (existingCookieValue) {
    const existingSession = await findSessionByCookieHash({
      cookieHash: hashGuestNavigationCookie(existingCookieValue),
      supabase,
    });

    if (existingSession) {
      const { error } = await supabase
        .from("guest_navigation_sessions")
        .update(sessionPayload)
        .eq("id", existingSession.id);

      if (error) {
        console.error("Failed to refresh guest navigation session", error);
        return null;
      }

      return { cookieValue: existingCookieValue, expiresAt };
    }
  }

  const cookieValue = generateGuestNavigationCookieValue();
  const { error } = await supabase.from("guest_navigation_sessions").insert({
    ...sessionPayload,
    cookie_hash: hashGuestNavigationCookie(cookieValue),
  });

  if (error) {
    console.error("Failed to create guest navigation session", error);
    return null;
  }

  return { cookieValue, expiresAt };
}
