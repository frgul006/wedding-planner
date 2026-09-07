import { rm } from 'node:fs/promises';

/** Credential deletion must not depend on process, browser, or registry cleanup succeeding. */
export async function cleanupPrivateTrial(
  privatePaths: string[],
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } finally {
    await Promise.all(privatePaths.map((path) => rm(path, { force: true })));
  }
}
