import type { Page } from "@playwright/test";

import { loadEnvFile } from "./env";

export function invitePathForToken(token: string) {
  return `/invite/${encodeURIComponent(token)}`;
}

export function absoluteUrl(path: string, baseURL: string) {
  return new URL(path, baseURL).toString();
}

export function pathFromAbsoluteUrl(url: string) {
  const parsedUrl = new URL(url);
  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

function originFromConfiguredUrl(value: string) {
  const hasProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(value);

  return new URL(hasProtocol ? value : `https://${value}`).origin;
}

function isLocalOrigin(origin: string) {
  const hostname = new URL(origin).hostname.toLowerCase();

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

export function expectedPublicOriginForPage(page: Page) {
  loadEnvFile();

  const pageOrigin = new URL(page.url()).origin;
  const configuredSiteUrl = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;

  if (!configuredSiteUrl) {
    return pageOrigin;
  }

  const configuredOrigin = originFromConfiguredUrl(configuredSiteUrl);

  if (isLocalOrigin(configuredOrigin) && !isLocalOrigin(pageOrigin)) {
    return pageOrigin;
  }

  return configuredOrigin;
}
