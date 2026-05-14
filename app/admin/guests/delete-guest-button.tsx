"use client";

import { useTransition } from "react";

import { softDeleteGuestAction } from "./actions";

type DeleteGuestButtonProps = {
  guestId: string;
  guestName: string;
};

export function DeleteGuestButton({ guestId, guestName }: DeleteGuestButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="rounded-full border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`Delete ${guestName}? This will archive the guest instead of permanently removing them.`)) {
          return;
        }

        startTransition(async () => {
          await softDeleteGuestAction(guestId);
        });
      }}
      type="button"
    >
      {isPending ? "Deleting..." : "Delete"}
    </button>
  );
}
