import { NextResponse, type NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
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

export const config = {
  matcher: ["/admin/:path*"],
};
