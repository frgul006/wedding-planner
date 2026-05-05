import { expect } from "@playwright/test";

import { signInAsSeededAdmin } from "./support/auth";
import { createE2eSupabaseAdminClient } from "./support/supabase";
import {
  createInviteTestGuest,
  uniqueInviteToken,
  uniqueRsvpGuestName,
} from "./support/invite-test-data";
import { testWithUpdates as test } from "./support/fixtures";
import { SEEDED_ADMIN } from "./support/test-data";
import { invitePathForToken } from "./support/urls";
import {
  createWeddingUpdate,
  uniqueWeddingUpdateTitle,
} from "./support/wedding-updates";

test.describe("invite updates feed", () => {
  test("publishes admin-created updates to invite pages and hides drafts", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Updates Admin Publish");
    const token = uniqueInviteToken("updates-admin-publish");
    const updateTitle = uniqueWeddingUpdateTitle("Admin Publish");
    await createInviteTestGuest({
      email: "e2e-updates-admin-publish@example.com",
      fullName: guestName,
      token,
    });

    await signInAsSeededAdmin(page);
    await page.getByRole("link", { name: "Manage updates" }).click();
    await expect(page.getByRole("heading", { name: "Wedding updates" })).toBeVisible();

    await page.getByLabel("Short title").first().fill(updateTitle);
    await page
      .getByLabel("Message text")
      .first()
      .fill("E2E shuttle buses leave the hotel at 14:15.");
    await page.getByLabel("Optional link").first().fill("https://example.com/e2e-update");
    await page.getByRole("button", { name: "Create update" }).click();

    await expect(page.getByText("Wedding update created.")).toBeVisible();
    const updateForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Save update" }),
    });
    await expect(updateForm).toBeVisible();
    await expect(updateForm.getByLabel("Short title")).toHaveValue(updateTitle);

    await page.goto(invitePathForToken(token));
    const updatesSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Updates" }),
    });
    await expect(updatesSection.getByRole("heading", { name: updateTitle })).toBeVisible();
    await expect(
      updatesSection.getByText("E2E shuttle buses leave the hotel at 14:15."),
    ).toBeVisible();
    await expect(updatesSection.getByRole("link", { name: "Open update link" }))
      .toHaveAttribute("href", "https://example.com/e2e-update");
    await expect(updatesSection.getByRole("link", { name: "Open update link" }))
      .toHaveAttribute("target", "_blank");
    await expect(updatesSection.getByRole("link", { name: "Open update link" }))
      .toHaveAttribute("rel", "noopener noreferrer");

    await page.goto("/admin/updates");
    const savedUpdateForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Save update" }),
    });
    await savedUpdateForm.getByLabel("Status").selectOption("draft");
    await savedUpdateForm.getByRole("button", { name: "Save update" }).click();
    await expect(page.getByText("Wedding update saved.")).toBeVisible();

    await page.goto(invitePathForToken(token));
    await expect(updatesSection.getByRole("heading", { name: updateTitle })).toHaveCount(
      0,
    );
    await expect(updatesSection.getByText("No updates yet")).toBeVisible();
  });

  test("keeps update creator provenance immutable", async () => {
    const supabase = createE2eSupabaseAdminClient();
    const title = uniqueWeddingUpdateTitle("Immutable Creator");
    const { data: adminProfile, error: adminProfileError } = await supabase
      .from("admin_profiles")
      .select("id")
      .eq("email", SEEDED_ADMIN.email)
      .single();

    expect(adminProfileError).toBeNull();

    if (!adminProfile || typeof adminProfile.id !== "string") {
      throw new Error("Expected seeded admin profile to exist.");
    }

    const updateId = await createWeddingUpdate({
      createdByAdminId: adminProfile.id,
      message: "E2E creator provenance must not change.",
      title,
    });

    const { error: updateError } = await supabase
      .from("wedding_updates")
      .update({ created_by_admin_id: null })
      .eq("id", updateId);

    expect(updateError?.message).toContain("created_by_admin_id cannot be changed");

    const { data: weddingUpdate, error: reloadError } = await supabase
      .from("wedding_updates")
      .select("created_by_admin_id")
      .eq("id", updateId)
      .single();

    expect(reloadError).toBeNull();
    expect(weddingUpdate?.created_by_admin_id).toBe(adminProfile.id);
  });

  test("shows the latest five published updates and hides draft or archived items", async ({
    page,
  }) => {
    const guestName = uniqueRsvpGuestName("Updates Latest Five");
    const token = uniqueInviteToken("updates-latest-five");
    const baseTime = Date.now();
    const titles = Array.from({ length: 6 }, (_, index) =>
      uniqueWeddingUpdateTitle(`Latest Five ${index + 1}`),
    );
    await createInviteTestGuest({
      email: "e2e-updates-latest-five@example.com",
      fullName: guestName,
      token,
    });

    await Promise.all(
      titles.map((title, index) =>
        createWeddingUpdate({
          message: `E2E latest-five message ${index + 1}`,
          title,
          updatedAt: new Date(baseTime + index * 1_000).toISOString(),
        }),
      ),
    );
    const draftTitle = uniqueWeddingUpdateTitle("Draft Hidden");
    const archivedTitle = uniqueWeddingUpdateTitle("Archived Hidden");
    await createWeddingUpdate({
      message: "E2E draft should stay hidden.",
      status: "draft",
      title: draftTitle,
      updatedAt: new Date(baseTime + 10_000).toISOString(),
    });
    await createWeddingUpdate({
      message: "E2E archived should stay hidden.",
      status: "archived",
      title: archivedTitle,
      updatedAt: new Date(baseTime + 11_000).toISOString(),
    });

    await page.goto(invitePathForToken(token));
    const updatesSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Updates" }),
    });

    await expect(updatesSection.getByRole("listitem")).toHaveCount(5);
    await expect(updatesSection.getByRole("heading", { name: titles[5] })).toBeVisible();
    await expect(updatesSection.getByRole("heading", { name: titles[4] })).toBeVisible();
    await expect(updatesSection.getByRole("heading", { name: titles[3] })).toBeVisible();
    await expect(updatesSection.getByRole("heading", { name: titles[2] })).toBeVisible();
    await expect(updatesSection.getByRole("heading", { name: titles[1] })).toBeVisible();
    await expect(updatesSection.getByRole("heading", { name: titles[0] })).toHaveCount(0);
    await expect(updatesSection.getByRole("heading", { name: draftTitle })).toHaveCount(0);
    await expect(updatesSection.getByRole("heading", { name: archivedTitle })).toHaveCount(
      0,
    );
  });
});
