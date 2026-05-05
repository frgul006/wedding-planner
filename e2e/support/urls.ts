export function invitePathForToken(token: string) {
  return `/invite/${encodeURIComponent(token)}`;
}

export function absoluteUrl(path: string, baseURL: string) {
  return new URL(path, baseURL).toString();
}
