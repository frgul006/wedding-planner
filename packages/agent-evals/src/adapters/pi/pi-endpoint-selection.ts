import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type PiEndpointPolicy = 'native' | 'catalog';
interface EndpointIdentity {
  origin: string;
  sha256: string;
}
export interface PiEndpointSelection {
  policy: PiEndpointPolicy;
  provider: string;
  model: string;
  savedOverride: EndpointIdentity | null;
  effective: EndpointIdentity;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const endpointHash = (value: string) => createHash('sha256').update(value).digest('hex');

function endpointIdentity(value: unknown): EndpointIdentity {
  if (typeof value !== 'string')
    throw new Error('Pi model endpoint is unavailable. Refresh its native model catalog.');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    // Preserve the exact identity without persisting URL credentials, queries or paths.
    return { origin: url.origin, sha256: endpointHash(value) };
  } catch {
    throw new Error('Pi model endpoint is not a valid HTTP URL.');
  }
}

/** Catalog mode is explicit; never transplant proxy credentials onto a different host. */
export function projectPiModelsConfiguration(
  serialized: string,
  provider: string,
  policy: PiEndpointPolicy,
): string {
  if (policy === 'native') return serialized;
  let configuration: Record<string, unknown>;
  try {
    configuration = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new Error('Cannot read native Pi model configuration.');
  }
  const providers = object(configuration.providers);
  const overrides = object(providers[provider]);
  if (!Object.hasOwn(overrides, 'baseUrl')) return serialized;
  // More complex overrides can contain credentials or model-specific routing.
  // Require a deliberate provider adapter instead of redirecting those silently.
  if (Object.keys(overrides).some((key) => key !== 'baseUrl'))
    throw new Error(
      'Catalog endpoint selection requires an endpoint-only provider override; custom provider credentials or model definitions cannot be redirected safely.',
    );
  delete providers[provider];
  return JSON.stringify({ ...configuration, providers }, null, 2);
}

export async function selectPiEndpoint(options: {
  agentDir: string;
  provider: string;
  model: string;
  policy?: PiEndpointPolicy;
}): Promise<PiEndpointSelection> {
  const policy = options.policy ?? 'native';
  let models = '{}';
  try {
    models = await readFile(join(options.agentDir, 'models.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cannot read native Pi model configuration.');
  }
  let custom: Record<string, unknown>;
  try {
    custom = object(object(JSON.parse(models)).providers);
  } catch {
    throw new Error('Cannot read native Pi model configuration.');
  }
  const provider = object(custom[options.provider]);
  const savedOverride = provider.baseUrl === undefined ? null : endpointIdentity(provider.baseUrl);
  // A custom native provider can be configured without a downloaded model catalog.
  if (policy === 'native' && savedOverride)
    return {
      policy,
      provider: options.provider,
      model: options.model,
      savedOverride,
      effective: savedOverride,
    };
  let catalog: Record<string, unknown>;
  try {
    catalog = object(
      JSON.parse(await readFile(join(options.agentDir, 'models-store.json'), 'utf8')),
    );
  } catch {
    throw new Error(
      'Cannot resolve Pi endpoint from its native model catalog. Refresh the native catalog before evaluation.',
    );
  }
  const entries = object(catalog[options.provider]).models;
  const model = Array.isArray(entries)
    ? entries.map(object).find((entry) => entry.id === options.model)
    : undefined;
  const catalogEndpoint = model?.baseUrl;
  if (policy === 'catalog') {
    projectPiModelsConfiguration(models, options.provider, policy);
    const parsed = typeof catalogEndpoint === 'string' ? new URL(catalogEndpoint) : undefined;
    if (
      !parsed ||
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        'Catalog endpoint selection requires a credential-free HTTPS endpoint from the native model catalog.',
      );
  }
  return {
    policy,
    provider: options.provider,
    model: options.model,
    savedOverride,
    effective: endpointIdentity(catalogEndpoint),
  };
}
