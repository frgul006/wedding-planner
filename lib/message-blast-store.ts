import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type CreatedMessageBlast,
  type CreatedMessageDelivery,
  type MessageBlastStore,
} from "@/lib/message-blast-command";
import { loadMessageTargets } from "@/lib/message-targets";
import { isRecord } from "@/lib/type-guards";

function isCreatedMessageBlast(value: unknown): value is CreatedMessageBlast {
  return isRecord(value) && typeof value.id === "string";
}

type SupabaseMessageDeliveryRow = {
  guest_id: string;
  id: string;
  phone: string;
};

function isSupabaseMessageDeliveryRow(value: unknown): value is SupabaseMessageDeliveryRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.guest_id === "string" &&
    typeof value.phone === "string"
  );
}

function toCreatedMessageDelivery(row: unknown): CreatedMessageDelivery | null {
  if (!isSupabaseMessageDeliveryRow(row)) {
    return null;
  }

  return {
    guestId: row.guest_id,
    id: row.id,
    phone: row.phone,
  };
}

export function createSupabaseMessageBlastStore(supabase: SupabaseClient): MessageBlastStore {
  return {
    async listMessageTargets({ weddingId }) {
      const result = await loadMessageTargets({ supabase, weddingId });

      if (result.error) {
        throw result.error;
      }

      return result.targets;
    },
    async createMessageBlast({ adminId, audience, body, title, weddingId }) {
      const { data, error } = await supabase
        .from("message_blasts")
        .insert({
          audience,
          body,
          created_by_admin_id: adminId,
          send_status: "queued",
          title,
          wedding_id: weddingId,
        })
        .select("id")
        .single();

      if (error || !isCreatedMessageBlast(data)) {
        throw error ?? new Error("Failed to create message blast.");
      }

      return data;
    },
    async createMessageDeliveries({ blastId, targets, weddingId }) {
      const { data, error } = await supabase
        .from("message_deliveries")
        .insert(
          targets.map((target) => ({
            delivery_status: "queued",
            guest_id: target.guestId,
            message_blast_id: blastId,
            phone: target.phone,
            wedding_id: weddingId,
          })),
        )
        .select("id, guest_id, phone");

      if (error) {
        throw error;
      }

      const deliveries = (data ?? [])
        .map(toCreatedMessageDelivery)
        .filter((delivery): delivery is CreatedMessageDelivery => delivery !== null);

      if (deliveries.length !== targets.length) {
        throw new Error("Failed to create every message delivery row.");
      }

      return deliveries;
    },
    async updateMessageDelivery({
      deliveryId,
      deliveryStatus,
      errorText,
      providerMessageId,
      weddingId,
    }) {
      const { error } = await supabase
        .from("message_deliveries")
        .update({
          delivery_status: deliveryStatus,
          error_text: errorText,
          provider_message_id: providerMessageId,
        })
        .eq("id", deliveryId)
        .eq("wedding_id", weddingId);

      if (error) {
        throw error;
      }
    },
    async updateMessageBlast({ blastId, sendStatus, sentAt, weddingId }) {
      const { error } = await supabase
        .from("message_blasts")
        .update({ send_status: sendStatus, sent_at: sentAt })
        .eq("id", blastId)
        .eq("wedding_id", weddingId);

      if (error) {
        throw error;
      }
    },
  };
}
