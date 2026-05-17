import { NextResponse, type NextRequest } from "next/server";

import {
  getGuestNavigationCookieValue,
  getGuestNavigationSessionMetadata,
} from "@/lib/guest-navigation-session";
import {
  prepareGuestNavigationSession,
  resolveInviteAccess,
} from "@/lib/invite-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

function getInviteTokenFromPathname(pathname: string) {
  const match = /^\/invite\/([^/]+)\/?$/.exec(pathname);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function addGuestNavigationCookieForInvite(
  request: NextRequest,
  response: NextResponse,
) {
  if (request.method !== "GET") {
    return response;
  }

  const rawToken = getInviteTokenFromPathname(request.nextUrl.pathname);

  if (!rawToken) {
    return response;
  }

  const supabase = createSupabaseAdminClient();
  const access = await resolveInviteAccess(rawToken, {
    includeRsvpResponse: false,
    supabase,
  });

  if (access.status === "denied") {
    return response;
  }

  const sessionCookie = await prepareGuestNavigationSession(access, {
    existingCookieValue: getGuestNavigationCookieValue(request),
    metadata: getGuestNavigationSessionMetadata(request),
    supabase,
  });

  if (sessionCookie) {
    response.cookies.set({
      name: sessionCookie.name,
      value: sessionCookie.value,
      ...sessionCookie.options,
    });
  }

  return response;
}

async function handleAdminProxy(request: NextRequest) {
  const { response, user, adminProfile } = await updateSupabaseSession(request);
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/admin/login")) {
    if (user && adminProfile) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    if (user && !adminProfile) {
      return NextResponse.redirect(new URL("/admin/unauthorized", request.url));
    }

    return response;
  }

  if (!user) {
    const redirectUrl = new URL("/admin/login", request.url);
    redirectUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  if (!adminProfile && !pathname.startsWith("/admin/unauthorized")) {
    return NextResponse.redirect(new URL("/admin/unauthorized", request.url));
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    return handleAdminProxy(request);
  }

  if (pathname.startsWith("/invite")) {
    return addGuestNavigationCookieForInvite(
      request,
      NextResponse.next({ request }),
    );
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: ["/admin/:path*", "/invite/:path*"],
};
