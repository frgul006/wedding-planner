export const MESSAGE_KINDS = ["custom", "invite_sms"] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  custom: "SMS message",
  invite_sms: "Invite SMS",
};

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && MESSAGE_KINDS.some((kind) => kind === value);
}

export function getMessageKindLabel(kind: MessageKind) {
  return MESSAGE_KIND_LABELS[kind];
}
