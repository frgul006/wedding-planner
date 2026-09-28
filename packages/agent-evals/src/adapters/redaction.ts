export function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]');
}

export function safeError(error: unknown): string {
  // SDK errors may include entire HTTP requests. Never stringify error objects.
  return redact(error instanceof Error ? error.message : 'Unknown error').slice(0, 1500);
}
