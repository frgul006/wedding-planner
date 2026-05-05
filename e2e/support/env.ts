import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const loadedEnvFiles = new Set<string>();

function parseEnvLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
    return null;
  }

  const [key, ...valueParts] = trimmed.split("=");
  const rawValue = valueParts.join("=").trim();
  const value = rawValue.replace(/^['"]|['"]$/g, "");

  return { key, value };
}

export function loadEnvFile(filePath = resolve(process.cwd(), ".env.local")) {
  const resolvedPath = resolve(filePath);

  if (loadedEnvFiles.has(resolvedPath) || !existsSync(resolvedPath)) {
    return;
  }

  for (const line of readFileSync(resolvedPath, "utf8").split(/\r?\n/)) {
    const parsedLine = parseEnvLine(line);

    if (!parsedLine || process.env[parsedLine.key]) {
      continue;
    }

    process.env[parsedLine.key] = parsedLine.value;
  }

  loadedEnvFiles.add(resolvedPath);
}

export function requireEnv(name: string) {
  loadEnvFile();

  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Is .env.local configured for e2e tests?`);
  }

  return value;
}
