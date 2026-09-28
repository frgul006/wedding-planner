import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

/** Load only the judge credential; never export the env file to the evaluated agent. */
export async function readJevKey(): Promise<string> {
  let apiKey: string | undefined;
  try {
    apiKey = parseEnv(
      await readFile(new URL('../.env.local', import.meta.url), 'utf8'),
    ).TYPESAFE_API_KEY;
  } catch {
    throw new Error('Cannot read the Wedding .env.local judge credential.');
  }
  if (!apiKey?.trim()) {
    throw new Error('TYPESAFE_API_KEY is missing from the Wedding .env.local.');
  }
  return apiKey;
}
