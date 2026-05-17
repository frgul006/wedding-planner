import { expect, type Locator, type Page } from "@playwright/test";

import { createE2eSupabaseAdminClient } from "./supabase";
import { SEEDED_WEDDING_ID } from "./test-data";
import { uniqueE2eValue } from "./unique";

export const E2E_GUEST_PREFIX = "E2E Guest";

export async function deleteE2eGuests() {
  const supabase = createE2eSupabaseAdminClient();
  const { error } = await supabase
    .from("guests")
    .delete()
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .like("full_name", `${E2E_GUEST_PREFIX}%`);

  if (error) {
    throw error;
  }
}

export async function getGuestByName(fullName: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("guests")
    .select("id, deleted_at, email, full_name, guest_kind, invited_guest_id, invite_status, phone, plus_one_allowed, rsvp_managed, rsvp_status, sms_opt_in, sms_opted_in_at, sms_opted_out_at")
    .eq("wedding_id", SEEDED_WEDDING_ID)
    .eq("full_name", fullName)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getInviteTokenRowsForGuest(guestId: string) {
  const supabase = createE2eSupabaseAdminClient();
  const { data, error } = await supabase
    .from("invite_tokens")
    .select("access_scope, id, is_active, invalidated_at, token_hash")
    .eq("guest_id", guestId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export function uniqueGuestName(label: string) {
  return uniqueE2eValue(E2E_GUEST_PREFIX, label);
}

export async function addGuest(page: Page, guest: {
  email?: string;
  fullName: string;
  notes?: string;
  phone?: string;
  plusOneAllowed?: boolean;
  smsOptIn?: boolean;
}) {
  await page.getByLabel("Full name", { exact: true }).fill(guest.fullName);
  await page.getByLabel("Email", { exact: true }).fill(guest.email ?? "");
  await page.getByLabel("Phone", { exact: true }).fill(guest.phone ?? "");

  if (guest.smsOptIn) {
    await page.getByLabel("SMS updates approved for this guest").check();
  }

  if (guest.plusOneAllowed) {
    await page.getByLabel("+1 allowed on invite").check();
  }

  await page.getByLabel("Notes", { exact: true }).fill(guest.notes ?? "");
  await page.getByRole("button", { name: "Add guest" }).click();
  await expect
    .poll(async () => (await getGuestByName(guest.fullName))?.full_name ?? null)
    .toBe(guest.fullName);
  await expect(page.getByText("Guest added.")).toBeVisible();
}

export async function guestRowByName(page: Page, fullName: string): Promise<Locator> {
  const rows = page.locator("tbody tr");
  const rowCount = await rows.count();

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const nameInput = row.locator('input[name="full_name"]');

    if ((await nameInput.count()) && (await nameInput.inputValue()) === fullName) {
      return row;
    }
  }

  throw new Error(`Could not find guest row for ${fullName}`);
}

export async function expectGuestRowVisible(page: Page, fullName: string) {
  await expect
    .poll(async () => {
      try {
        await guestRowByName(page, fullName);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await expect((await guestRowByName(page, fullName)).locator('input[name="full_name"]'))
    .toHaveValue(fullName);
}

export async function expectGuestRowHidden(page: Page, fullName: string) {
  await expect
    .poll(async () => {
      const rows = page.locator("tbody tr");
      const rowCount = await rows.count();

      for (let index = 0; index < rowCount; index += 1) {
        if ((await rows.nth(index).locator('input[name="full_name"]').inputValue()) === fullName) {
          return false;
        }
      }

      return true;
    })
    .toBe(true);
}

export async function saveGuestRow(row: Locator) {
  await row.getByRole("button", { name: "Save" }).click();
}

export async function deleteGuestRow(row: Locator, confirm: boolean) {
  const page = row.page();
  page.once("dialog", async (dialog) => {
    if (confirm) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await row.getByRole("button", { name: "Delete" }).click();
}
