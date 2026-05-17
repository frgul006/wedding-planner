export const INVITE_RSVP_PANEL_ID = "osa";
export const INVITE_RSVP_SUBMITTED_PARAM = "rsvp_status";
export const INVITE_RSVP_SUBMITTED_VALUE = "submitted";

type InviteRsvpSearchParams = Partial<
  Record<typeof INVITE_RSVP_SUBMITTED_PARAM, string | string[]>
>;

type InviteRsvpLocation = {
  pathname: string;
  search: string;
};

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildInviteRsvpPanelHash() {
  return `#${INVITE_RSVP_PANEL_ID}`;
}

export function getInviteRsvpSubmittedHref(rawToken: string) {
  const tokenPath = encodeURIComponent(rawToken);
  const searchParams = new URLSearchParams({
    [INVITE_RSVP_SUBMITTED_PARAM]: INVITE_RSVP_SUBMITTED_VALUE,
  });
  const queryString = searchParams.toString();

  return `/invite/${tokenPath}?${queryString}${buildInviteRsvpPanelHash()}`;
}

export function getInviteRsvpEditHrefFromLocation(location: InviteRsvpLocation) {
  const searchParams = new URLSearchParams(location.search);
  searchParams.delete(INVITE_RSVP_SUBMITTED_PARAM);

  const queryString = searchParams.toString();
  const query = queryString ? `?${queryString}` : "";

  return `${location.pathname}${query}${buildInviteRsvpPanelHash()}`;
}

export function shouldShowInviteRsvpSubmittedConfirmation(
  searchParams: InviteRsvpSearchParams,
) {
  return (
    getFirstParam(searchParams[INVITE_RSVP_SUBMITTED_PARAM]) ===
    INVITE_RSVP_SUBMITTED_VALUE
  );
}

export function isInviteRsvpClientActionAcceptHeader(
  acceptHeader: string | null | undefined,
) {
  return acceptHeader?.includes("text/x-component") ?? false;
}
