import { test as base } from "@playwright/test";

import { deleteE2eGuests } from "./admin-guests";
import { resetWeddingSettings } from "./wedding-settings";
import { deleteE2eWeddingUpdates } from "./wedding-updates";

async function runWithCleanup(
  cleanup: () => Promise<void>,
  runTest: () => Promise<void>,
) {
  await cleanup();

  try {
    await runTest();
  } finally {
    await cleanup();
  }
}

export const testWithGuests = base.extend<{ cleanGuests: void }>({
  cleanGuests: [
    async ({ browserName }, use) => {
      void browserName;
      await runWithCleanup(deleteE2eGuests, use);
    },
    { auto: true },
  ],
});

export const testWithWeddingSettings = testWithGuests.extend<{
  cleanWeddingSettings: void;
}>({
  cleanWeddingSettings: [
    async ({ browserName }, use) => {
      void browserName;
      await runWithCleanup(resetWeddingSettings, use);
    },
    { auto: true },
  ],
});

export const testWithUpdates = testWithGuests.extend<{ cleanWeddingUpdates: void }>({
  cleanWeddingUpdates: [
    async ({ browserName }, use) => {
      void browserName;
      await runWithCleanup(deleteE2eWeddingUpdates, use);
    },
    { auto: true },
  ],
});
