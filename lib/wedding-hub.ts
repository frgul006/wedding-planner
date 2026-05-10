export const WEDDING_HUB_PATH = "/wedding-hub";

function getConfiguredSiteOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  const siteUrl = configuredUrl ?? vercelUrl;

  if (!siteUrl) {
    return null;
  }

  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}

export function getWeddingHubUrl(requestUrl?: string) {
  const configuredOrigin = getConfiguredSiteOrigin();
  const fallbackOrigin = requestUrl ? new URL(requestUrl).origin : "http://localhost:3000";

  return new URL(WEDDING_HUB_PATH, configuredOrigin ?? fallbackOrigin).toString();
}
