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
  wedding_id: string;
  guest_id: string | null;
  invite_token_id: string | null;
  is_anonymous: boolean;
  expires_at: string | null;
};


export type GuestNavigationSessionLookup = {
  id: string;
  weddingId: string;
  guestId: string | null;
  inviteTokenId: string | null;
  isAnonymous: boolean;
};

function isGuestNavigationSessionRow(value: unknown): value is GuestNavigationSessionRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.wedding_id === "string" &&
    (value.guest_id === null || typeof value.guest_id === "string") &&
    (value.invite_token_id === null || typeof value.invite_token_id === "string") &&
    typeof value.is_anonymous === "boolean"
  );
}

function toGuestNavigationSessionLookup(value: GuestNavigationSessionRow): GuestNavigationSessionLookup {
  return {
    id: value.id,
    weddingId: value.wedding_id,
    guestId: value.guest_id,
    inviteTokenId: value.invite_token_id,
    isAnonymous: value.is_anonymous,
  };
}

export async function getGuestNavigationSessionByCookieHash({
  cookieHash,
  weddingId,
  supabase,
}: {
  cookieHash: string;
  weddingId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from("guest_navigation_sessions")
    .select("id, wedding_id, guest_id, invite_token_id, is_anonymous, expires_at")
    .eq("cookie_hash", cookieHash)
    .eq("wedding_id", weddingId)
    .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to resolve guest navigation session", error);
    return null;
  }

  if (!isGuestNavigationSessionRow(data)) {
    return null;
  }

  return toGuestNavigationSessionLookup(data);
}

export async function getAttributableGuestNavigationSession({
  existingCookieValue,
  supabase,
  weddingId,
}: {
  existingCookieValue: string | null;
  supabase: SupabaseClient;
  weddingId: string;
}) {
  if (!existingCookieValue || !weddingId) {
    return null;
  }

  return getGuestNavigationSessionByCookieHash({
    cookieHash: hashGuestNavigationCookie(existingCookieValue),
    weddingId,
    supabase,
  });
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

  return data && typeof data.id === "string" ? data : null;
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
