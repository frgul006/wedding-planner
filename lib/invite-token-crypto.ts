import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateRawInviteToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInviteToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
