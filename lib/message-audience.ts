export const MESSAGE_AUDIENCES = ["all", "rsvp yes", "rsvp no", "rsvp maybe"] as const;

export type MessageAudience = (typeof MESSAGE_AUDIENCES)[number];

const MESSAGE_AUDIENCE_LABELS: Record<MessageAudience, string> = {
  all: "All guests",
  "rsvp yes": "RSVP Yes",
  "rsvp no": "RSVP No",
  "rsvp maybe": "RSVP Maybe",
};

export function isMessageAudience(value: unknown): value is MessageAudience {
  return typeof value === "string" && MESSAGE_AUDIENCES.some((audience) => audience === value);
}

export function getMessageAudienceLabel(audience: MessageAudience) {
  return MESSAGE_AUDIENCE_LABELS[audience];
}
