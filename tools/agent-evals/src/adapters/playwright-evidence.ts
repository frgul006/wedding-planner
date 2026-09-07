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
  // A closing fence at the end distinguishes complete explicit output from a
  // clipped snapshot or an earlier automatic snapshot followed by other text.
  const finalInlineSnapshot = /(?:^|\n)### Snapshot\r?\n```yaml\r?\n([\s\S]*?)\r?\n```\r?\n?$/.exec(
    text,
  )?.[1];
  return {
    pageUrls,
    linkedSnapshotPaths,
    ...(finalInlineSnapshot !== undefined ? { finalInlineSnapshot } : {}),
    hasError: /^### Error\r?$/m.test(text),
  };
}
