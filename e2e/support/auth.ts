import { expect, type Page } from "@playwright/test";

import { SEEDED_ADMIN } from "./test-data";

export async function signInAsSeededAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(SEEDED_ADMIN.email);
  await page.getByLabel("Password").fill(SEEDED_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
}

export async function signOutAdmin(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();
}
