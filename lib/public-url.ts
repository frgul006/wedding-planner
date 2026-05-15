export type PublicUrlOptions = {
  requestOrigin?: string | null;
  requestUrl?: string | null;
};

const DEFAULT_LOCAL_ORIGIN = "http://localhost:3000";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function normalizeProtocol(value: string | null) {
  const protocol = value?.trim().toLowerCase();

  return protocol === "http" || protocol === "https" ? protocol : null;
}

function normalizeOrigin(value: string | null | undefined, defaultProtocol: "http" | "https") {
  const trimmed = value?.trim();

  if (!trimmed || trimmed.toLowerCase() === "null") {
    return null;
  }

  const hasProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `${defaultProtocol}://${trimmed}`;

  try {
    const url = new URL(candidate);

    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  return (
    LOCAL_HOSTNAMES.has(normalizedHostname) ||
    normalizedHostname.endsWith(".localhost")
  );
}

function isLocalOrigin(origin: string) {
  try {
    return isLocalHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function originFromHost(host: string | null, protocolHint: "http" | "https" | null) {
  if (!host) {
    return null;
  }

  const localFallback = normalizeOrigin(host, "http");
  const defaultProtocol = localFallback && isLocalOrigin(localFallback) ? "http" : "https";

  return normalizeOrigin(host, protocolHint ?? defaultProtocol);
}

function getConfiguredSiteOrigin() {
  return normalizeOrigin(
    process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
    "https",
  );
}

function getVercelDeploymentOrigin() {
  return normalizeOrigin(process.env.VERCEL_URL, "https");
}

export function getRequestOriginFromUrl(requestUrl: string | null | undefined) {
  return normalizeOrigin(requestUrl, "https");
}

export function getRequestOriginFromHeaders(headersList: Headers) {
  const host = firstHeaderValue(headersList.get("host"));
  const forwardedHost = firstHeaderValue(headersList.get("x-forwarded-host"));
  const forwardedProto = normalizeProtocol(firstHeaderValue(headersList.get("x-forwarded-proto")));
  const originHeader = normalizeOrigin(headersList.get("origin"), "https");
  const hostOrigin = originFromHost(host, forwardedProto);
  const forwardedOrigin = originFromHost(forwardedHost, forwardedProto);
  const candidates = [forwardedOrigin, hostOrigin, originHeader].filter(
    (origin): origin is string => Boolean(origin),
  );

  return candidates.find((origin) => !isLocalOrigin(origin)) ?? candidates[0] ?? null;
}

export function resolvePublicAppOrigin(options: PublicUrlOptions = {}) {
  const configuredOrigin = getConfiguredSiteOrigin();
  const requestOrigin = options.requestOrigin ?? getRequestOriginFromUrl(options.requestUrl);

  if (configuredOrigin && requestOrigin) {
    const configuredIsLocal = isLocalOrigin(configuredOrigin);
    const requestIsLocal = isLocalOrigin(requestOrigin);

    if (configuredIsLocal && !requestIsLocal) {
      return requestOrigin;
    }

    return configuredOrigin;
  }

  return configuredOrigin ?? requestOrigin ?? getVercelDeploymentOrigin() ?? DEFAULT_LOCAL_ORIGIN;
}

export function buildPublicUrl(path: string, options?: PublicUrlOptions) {
  return new URL(path, resolvePublicAppOrigin(options)).toString();
}
