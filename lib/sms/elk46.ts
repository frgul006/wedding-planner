import "server-only";

import { Buffer } from "node:buffer";

import { isE164PhoneNumber } from "@/lib/phone";
import { isRecord } from "@/lib/type-guards";

const ELK46_SMS_API_URL = "https://api.46elks.com/a1/sms";
const DEFAULT_ELK46_SENDER = "Wedding";
const ALPHANUMERIC_SENDER_REGEX = /^[A-Za-z0-9]{1,11}$/;

export type Elk46RuntimeStatus = {
  isConfigured: boolean;
  missingEnv: string[];
  mockSend: boolean;
  sender: string;
  senderIsValid: boolean;
};

export type SendElk46SmsInput = {
  message: string;
  to: string;
};

export type SendElk46SmsResult = {
  cost: number | null;
  parts: number | null;
  providerMessageId: string | null;
};

type Elk46Config = {
  from: string;
  mockSend: boolean;
  password: string;
  user: string;
};

export class Elk46ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Elk46ConfigError";
  }
}

export class Elk46SendError extends Error {
  readonly providerStatus: number;
  readonly providerText: string;

  constructor({ providerStatus, providerText }: { providerStatus: number; providerText: string }) {
    super(`46elks SMS request failed with status ${providerStatus}.`);
    this.name = "Elk46SendError";
    this.providerStatus = providerStatus;
    this.providerText = providerText;
  }
}

function getEnvValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function getSender() {
  return getEnvValue("ELK46_FROM") ?? DEFAULT_ELK46_SENDER;
}

function isValidSender(sender: string) {
  return isE164PhoneNumber(sender) || ALPHANUMERIC_SENDER_REGEX.test(sender);
}

export function getElk46RuntimeStatus(): Elk46RuntimeStatus {
  const user = getEnvValue("ELK46_USER");
  const password = getEnvValue("ELK46_PASSWORD");
  const sender = getSender();
  const mockSend = process.env.ELK46_MOCK_SEND === "1";
  const missingEnv: string[] = [];

  if (!mockSend && !user) {
    missingEnv.push("ELK46_USER");
  }

  if (!mockSend && !password) {
    missingEnv.push("ELK46_PASSWORD");
  }

  return {
    isConfigured: missingEnv.length === 0 && isValidSender(sender),
    missingEnv,
    mockSend,
    sender,
    senderIsValid: isValidSender(sender),
  };
}

function readElk46Config(): Elk46Config {
  const status = getElk46RuntimeStatus();

  if (status.missingEnv.length > 0) {
    throw new Elk46ConfigError(`Missing SMS provider env vars: ${status.missingEnv.join(", ")}.`);
  }

  if (!status.senderIsValid) {
    throw new Elk46ConfigError(
      "ELK46_FROM must be an E.164 phone number or 1-11 alphanumeric characters.",
    );
  }

  return {
    from: status.sender,
    mockSend: status.mockSend,
    password: getEnvValue("ELK46_PASSWORD") ?? "",
    user: getEnvValue("ELK46_USER") ?? "",
  };
}

function getNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function sendElk46Sms({ message, to }: SendElk46SmsInput): Promise<SendElk46SmsResult> {
  if (!isE164PhoneNumber(to)) {
    throw new Elk46ConfigError("SMS recipient phone number must use E.164 format.");
  }

  const config = readElk46Config();

  if (config.mockSend) {
    return {
      cost: 0,
      parts: 1,
      providerMessageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
  }

  const body = new URLSearchParams({
    from: config.from,
    message,
    to,
  });
  const auth = Buffer.from(`${config.user}:${config.password}`).toString("base64");
  const response = await fetch(ELK46_SMS_API_URL, {
    body,
    cache: "no-store",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Elk46SendError({
      providerStatus: response.status,
      providerText: responseText,
    });
  }

  let responseJson: unknown = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Elk46SendError({
      providerStatus: response.status,
      providerText: responseText,
    });
  }

  if (!isRecord(responseJson)) {
    throw new Elk46SendError({
      providerStatus: response.status,
      providerText: responseText,
    });
  }

  return {
    cost: getNullableNumber(responseJson.cost),
    parts: getNullableNumber(responseJson.parts),
    providerMessageId: getNullableString(responseJson.id),
  };
}
