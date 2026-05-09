#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ELK46_SMS_API_URL = "https://api.46elks.com/a1/sms";
const DEFAULT_ELK46_SENDER = "Wedding";
const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
const ALPHANUMERIC_SENDER_REGEX = /^[A-Za-z0-9]{1,11}$/;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").replace(/^["']|["']$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}. Is .env.local configured?`);
  }

  return value;
}

function getSender() {
  return process.env.ELK46_FROM?.trim() || DEFAULT_ELK46_SENDER;
}

function assertValidSender(sender) {
  if (!PHONE_E164_REGEX.test(sender) && !ALPHANUMERIC_SENDER_REGEX.test(sender)) {
    throw new Error("ELK46_FROM must be an E.164 phone number or 1-11 alphanumeric characters.");
  }
}

function maskPhoneNumber(phone) {
  return `${phone.slice(0, 4)}…${phone.slice(-2)}`;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const mockSend = process.env.ELK46_MOCK_SEND === "1";
  const user = mockSend ? "" : requireEnv("ELK46_USER");
  const password = mockSend ? "" : requireEnv("ELK46_PASSWORD");
  const to = requireEnv("ELK46_TEST_PHONE_NUMBER");
  const from = getSender();

  if (!PHONE_E164_REGEX.test(to)) {
    throw new Error("ELK46_TEST_PHONE_NUMBER must use E.164 format, e.g. +46701234567.");
  }

  assertValidSender(from);

  if (mockSend) {
    console.log(
      `46elks mock send enabled; would send a test SMS from ${from} to ${maskPhoneNumber(to)}.`,
    );
    return;
  }

  const body = new URLSearchParams({
    from,
    message: `Wedding Planner SMS test sent at ${new Date().toISOString()}`,
    to,
  });
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  const response = await fetch(ELK46_SMS_API_URL, {
    body,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`46elks test SMS failed with status ${response.status}: ${responseText}`);
  }

  console.log("46elks test SMS sent:");
  console.log(responseText);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
