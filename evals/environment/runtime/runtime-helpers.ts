import { copyFile } from 'node:fs/promises';

type RuntimeHelper =
  'isolation/pi-tool-boundary' | 'isolation/file-worker' | 'repository/repository-acceptance';

/** Copy standalone JavaScript into the trial's private controls, without a TS loader. */
export async function copyRuntimeHelper(name: RuntimeHelper, destination: string): Promise<void> {
  const source = new URL(`../../dist/${name}.mjs`, import.meta.url);
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    throw new Error(
      `Cannot copy compiled runtime helper ${name}. Run pnpm build:evals before starting a trial.`,
      { cause: error },
    );
  }
}
