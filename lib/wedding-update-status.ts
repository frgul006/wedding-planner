export const WEDDING_UPDATE_STATUSES = ["draft", "published", "archived"] as const;

export type WeddingUpdateStatus = (typeof WEDDING_UPDATE_STATUSES)[number];

export function isWeddingUpdateStatus(value: unknown): value is WeddingUpdateStatus {
  return (
    typeof value === "string" &&
    WEDDING_UPDATE_STATUSES.some((status) => status === value)
  );
}
