export function getSafeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function parseOptionalHttpUrl(value: FormDataEntryValue | null) {
  const rawUrl = typeof value === "string" ? value.trim() : "";

  if (!rawUrl) {
    return { isValid: true, url: null };
  }

  const url = getSafeHttpUrl(rawUrl);

  if (!url) {
    return { isValid: false, url: null };
  }

  return { isValid: true, url };
}
