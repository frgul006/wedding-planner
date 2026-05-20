export const GUEST_KIND = {
  invited: "invited",
  plusOne: "plus_one",
} as const;

export const INVITE_ACCESS_SCOPE = {
  full: "full",
  scoped: "scoped",
} as const;

export type GuestKind = (typeof GUEST_KIND)[keyof typeof GUEST_KIND];
export type InviteAccessScope =
  (typeof INVITE_ACCESS_SCOPE)[keyof typeof INVITE_ACCESS_SCOPE];

export function isGuestKind(value: unknown): value is GuestKind {
  return value === GUEST_KIND.invited || value === GUEST_KIND.plusOne;
}

export function isInviteAccessScope(value: unknown): value is InviteAccessScope {
  return value === INVITE_ACCESS_SCOPE.full || value === INVITE_ACCESS_SCOPE.scoped;
}

export function getGuestKindLabel(guestKind: GuestKind) {
  return guestKind === GUEST_KIND.plusOne ? "Plus-one Guest" : "Invited Guest";
}

export function getInviteAccessScopeForGuestKind(
  guestKind: GuestKind,
): InviteAccessScope {
  return guestKind === GUEST_KIND.plusOne
    ? INVITE_ACCESS_SCOPE.scoped
    : INVITE_ACCESS_SCOPE.full;
}

export function isValidInviteAccessScopeForGuestKind({
  accessScope,
  guestKind,
}: {
  accessScope: InviteAccessScope;
  guestKind: GuestKind;
}) {
  return getInviteAccessScopeForGuestKind(guestKind) === accessScope;
}
