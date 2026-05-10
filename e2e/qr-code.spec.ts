import { expect } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import { testWithWeddingSettings as test } from "./support/fixtures";
import {
  BASELINE_WEDDING_SETTINGS,
  updateWeddingSettings,
} from "./support/wedding-settings";

test.describe("wedding hub QR", () => {
  test("admin can view, download, and open the shared hub QR", async ({ page }) => {
    const unauthenticatedQrResponse = await page.request.get("/admin/qr-code/png", {
      maxRedirects: 0,
    });
    expect(unauthenticatedQrResponse.status()).toBe(307);
    expect(unauthenticatedQrResponse.headers().location).toContain("/admin/login");

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage QR code" }).click();

    await expect(page.getByRole("heading", { name: "Wedding hub QR" })).toBeVisible();
    await expect(page.getByAltText("QR code for the wedding hub")).toBeVisible();
    await expect(page.getByLabel("Hub URL")).toHaveValue(/\/wedding-hub$/);
    await expect(page.getByRole("link", { name: "Download PNG" })).toHaveAttribute(
      "href",
      "/admin/qr-code/png?download=1",
    );
    await expect(page.getByRole("link", { name: "Open wedding hub" })).toHaveAttribute(
      "href",
      /\/wedding-hub$/,
    );

    const qrResponse = await page.request.get("/admin/qr-code/png");
    expect(qrResponse.ok()).toBeTruthy();
    expect(qrResponse.headers()["content-type"]).toContain("image/png");
    expect((await qrResponse.body()).byteLength).toBeGreaterThan(1_000);
  });

  test("public wedding hub shows the sketch-inspired actions without fake feed items", async ({
    page,
  }) => {
    await page.goto("/wedding-hub");

    await expect(page.getByRole("heading", { name: /Lägg till en låt/ })).toBeVisible();
    await expect(page.getByText("Inga bidrag än")).toBeVisible();
    await expect(page.getByText("Bilduppladdning kommer i nästa byggsteg.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Bilder Kommer snart/ })).toBeDisabled();
    await expect(page.getByRole("link", { name: /Öppna Spotify/ })).toHaveAttribute(
      "href",
      BASELINE_WEDDING_SETTINGS.spotify_playlist_url,
    );
    await expect(page.getByRole("link", { name: /Lägg till låt/ })).toHaveAttribute(
      "href",
      BASELINE_WEDDING_SETTINGS.spotify_playlist_url,
    );
  });

  test("public wedding hub explains when anonymous uploads are disabled", async ({
    page,
  }) => {
    await updateWeddingSettings({ allow_anonymous_hub_upload: false });

    await page.goto("/wedding-hub");

    await expect(
      page.getByText("När anonym uppladdning är avstängd kommer gäster behöva"),
    ).toBeVisible();
  });
});
