import { expect, test } from "@playwright/test";

import { getRequestOriginFromHeaders } from "../lib/public-url";

test.describe("public URL origin resolution", () => {
  test("prefers forwarded host over upstream host", () => {
    const headers = new Headers({
      host: "internal-service.example.com",
      "x-forwarded-host": "wedding-planner-gamma-lovat.vercel.app",
      "x-forwarded-proto": "https",
    });

    expect(getRequestOriginFromHeaders(headers)).toBe(
      "https://wedding-planner-gamma-lovat.vercel.app",
    );
  });

  test("falls back to host when forwarded host is absent", () => {
    const headers = new Headers({
      host: "wedding-planner-git-main-mjaox-wedding-planner.vercel.app",
      "x-forwarded-proto": "https",
    });

    expect(getRequestOriginFromHeaders(headers)).toBe(
      "https://wedding-planner-git-main-mjaox-wedding-planner.vercel.app",
    );
  });
});
