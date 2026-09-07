import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Credential = Record<string, unknown>;
const OAUTH_REFRESH_WINDOW_MS = 5 * 60_000;
const SETUP_ALLOWANCE_MS = 2 * 60_000;
const SHUTDOWN_ALLOWANCE_MS = 15_000;

export interface PrivateAuthentication {
  provider: string;
  type: 'oauth' | 'api_key';
  strategy: 'native-locked-refresh-before-private-copy';
  checkedAt: string;
  minimumValidityMs: number;
  expiresAt?: string;
  refreshed: boolean;
}

/** Native Pi owns refresh and persistence on the original credential store. */
export interface NativeCredentialAccess {
  read(provider: string): Promise<Credential | undefined>;
  ensureValidity(provider: string, minimumValidityMs: number): Promise<unknown>;
}

function requireCredential(
  credential: Credential | undefined,
): Credential & { type: 'oauth' | 'api_key' } {
  if (!credential || !['oauth', 'api_key'].includes(String(credential.type))) {
    throw new Error(
      'The selected Pi provider has no supported stored authentication. Sign in with Pi before running an evaluation.',
    );
  }
  return credential as Credential & { type: 'oauth' | 'api_key' };
}

function requireValidity(credential: Credential, minimumValidityMs: number, now: number): void {
  if (credential.type !== 'oauth') return;
  if (
    typeof credential.expires !== 'number' ||
    !Number.isFinite(credential.expires) ||
    credential.expires <= now + minimumValidityMs
  ) {
    throw new Error(
      'Pi OAuth authentication cannot stay valid for the entire bounded trial. Refresh authentication in Pi and retry. No agent prompt was dispatched.',
    );
  }
}

/**
 * Never rotate an OAuth token in a disposable copy: that would leave normal Pi
 * with the old refresh token. Resolve it under native locking first, then give
 * the trial only its selected provider and enough validity to avoid a refresh.
 */
export async function copyPreparedAuthentication(
  options: {
    provider: string;
    destination: string;
    runtimeMs: number;
    now?: () => number;
  },
  native: NativeCredentialAccess,
): Promise<PrivateAuthentication> {
  const now = options.now ?? Date.now;
  const minimumValidityMs = options.runtimeMs + OAUTH_REFRESH_WINDOW_MS + SETUP_ALLOWANCE_MS;
  const readSelected = async () => {
    let credential;
    try {
      credential = await native.read(options.provider);
    } catch {
      throw new Error(
        'Native Pi could not read its stored authentication. Check Pi authentication and retry.',
      );
    }
    return requireCredential(credential);
  };
  const before = await readSelected();
  if (before.type === 'oauth') {
    try {
      if (!(await native.ensureValidity(options.provider, minimumValidityMs)))
        throw new Error('Authentication unavailable');
    } catch {
      // Native errors can contain credentials or provider response bodies.
      throw new Error(
        'Native Pi could not prepare authentication for the bounded trial. Check Pi authentication and retry. No agent prompt was dispatched.',
      );
    }
  }
  const credential = await readSelected();
  requireValidity(credential, minimumValidityMs, now());
  await writeFile(options.destination, JSON.stringify({ [options.provider]: credential }), {
    mode: 0o600,
  });
  return {
    provider: options.provider,
    type: credential.type,
    strategy: 'native-locked-refresh-before-private-copy',
    checkedAt: new Date(now()).toISOString(),
    minimumValidityMs,
    ...(credential.type === 'oauth'
      ? { expiresAt: new Date(credential.expires as number).toISOString() }
      : {}),
    refreshed: before.type === 'oauth' && before.access !== credential.access,
  };
}

export async function preparePrivatePiAuthentication(options: {
  packageRoot: string;
  agentDirectory: string;
  destination: string;
  provider: string;
  runtimeMs: number;
}): Promise<PrivateAuthentication> {
  try {
    const nativeModule = (name: string) =>
      import(pathToFileURL(join(options.packageRoot, 'dist/core', `${name}.js`)).href);
    const [{ AuthStorage }, { ModelRuntime }, { InMemoryCodingAgentModelsStore }] =
      await Promise.all([
        nativeModule('auth-storage'),
        nativeModule('model-runtime'),
        nativeModule('models-store'),
      ]);
    // Pass the original path, not a symlink: Pi locks with realpath:false, so a
    // symlink would create a different lock from the user's normal Pi process.
    const credentials = AuthStorage.create(join(options.agentDirectory, 'auth.json'));
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: join(options.agentDirectory, 'models.json'),
      modelsStore: new InMemoryCodingAgentModelsStore(),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    return await copyPreparedAuthentication(options, {
      read: (provider) => credentials.read(provider),
      ensureValidity: (provider, minimumValidityMs) =>
        runtime.getAuth(provider, {
          minOAuthValidityMs: minimumValidityMs,
          signal: AbortSignal.timeout(20_000),
        }),
    });
  } catch {
    // Import/configuration errors can contain credential-bearing JSON snippets.
    throw new Error(
      'Native Pi authentication preparation failed. Check Pi authentication and retry. No agent prompt was dispatched.',
    );
  }
}

/** Setup time cannot consume the validity reserved for native Pi's next turn. */
export async function verifyPrivatePiAuthentication(options: {
  destination: string;
  provider: string;
  runtimeMs: number;
  now?: number;
}): Promise<void> {
  let data: Record<string, Credential>;
  try {
    data = JSON.parse(await readFile(options.destination, 'utf8')) as Record<string, Credential>;
  } catch {
    throw new Error(
      'The private Pi authentication copy could not be verified. No agent prompt was dispatched.',
    );
  }
  requireValidity(
    requireCredential(data[options.provider]),
    options.runtimeMs + OAUTH_REFRESH_WINDOW_MS + SHUTDOWN_ALLOWANCE_MS,
    options.now ?? Date.now(),
  );
}
