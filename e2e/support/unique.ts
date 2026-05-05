import { randomUUID } from "node:crypto";

type UniqueE2eValueOptions = {
  slug?: boolean;
};

export function uniqueE2eValue(
  prefix: string,
  label: string,
  options: UniqueE2eValueOptions = {},
) {
  const separator = options.slug ? "-" : " ";
  const value = [prefix, label, Date.now().toString(), randomUUID()].join(separator);

  if (!options.slug) {
    return value;
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
