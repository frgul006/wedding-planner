import { expect, test } from "@playwright/test";

test("loads the public app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Wedding Planner");
  await expect(
    page.getByRole("heading", { name: "To get started, edit the page.tsx file." }),
  ).toBeVisible();
});
