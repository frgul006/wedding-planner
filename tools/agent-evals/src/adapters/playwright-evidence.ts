import type { BrowserOutput } from '../domain/types.ts';

/** Decode observed native records, without deciding whether their flow is correct. */
export function parsePlaywrightOutput(text: string): BrowserOutput {
  const pageUrls = [...text.matchAll(/^### Page\r?\n- Page URL: ([^\s]+)\r?$/gm)].map(
    (match) => match[1],
  );
  const linkedSnapshotPaths = [
    ...text.matchAll(
      /^### Snapshot\r?\n(?:- )?\[Snapshot\]\((\.playwright-cli\/[^\s)]+\.ya?ml)\)\r?$/gm,
    ),
  ].map((match) => match[1]);
  // Close each YAML block at its first fence, then require the last block to end
  // the output. An end-anchored regex can backtrack across a YAML closing fence
  // and accidentally absorb later JavaScript output as part of the snapshot.
  const finalSnapshot = [
    ...text.matchAll(/^### Snapshot\r?\n```yaml\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/gm),
  ].at(-1);
  const finalInlineSnapshot =
    finalSnapshot && finalSnapshot.index + finalSnapshot[0].length === text.length
      ? finalSnapshot[1]
      : undefined;
  return {
    pageUrls,
    linkedSnapshotPaths,
    ...(finalInlineSnapshot !== undefined ? { finalInlineSnapshot } : {}),
    hasError: /^### Error\r?$/m.test(text),
  };
}
