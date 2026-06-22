import type { NextRequest } from "next/server";

import {
  createInviteCalendarFile,
  getInviteCalendarFilename,
  getInvitePath,
} from "@/lib/invite-calendar";
import { resolveInviteAccess } from "@/lib/invite-access";
import { buildPublicUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

type CalendarRouteContext = {
  params: Promise<{
    token: string;
  }>;
};

function notFoundResponse() {
  return new Response("Calendar action unavailable", {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
    status: 404,
  });
}

export async function GET(request: NextRequest, { params }: CalendarRouteContext) {
  const { token } = await params;
  const access = await resolveInviteAccess(token);

  if (access.status === "denied") {
    return notFoundResponse();
  }

  const inviteUrl = buildPublicUrl(getInvitePath(token), { requestUrl: request.url });
  const calendarFile = createInviteCalendarFile({ access, inviteUrl });

  if (!calendarFile) {
    return notFoundResponse();
  }

  return new Response(calendarFile, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${getInviteCalendarFilename(
        access.wedding.name,
      )}"`,
      "Content-Type": "text/calendar; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
