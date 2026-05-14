"use client";

import { useState, useTransition } from "react";

import {
  approvePhotoUploadAction,
  deletePhotoUploadAction,
  hidePhotoUploadAction,
} from "./actions";

type PhotoModerationActionsProps = {
  currentFilter: string;
  deletedAt: string | null;
  fileName: string;
  moderationStatus: string;
  photoId: string;
  verificationStatus: string;
};

export function PhotoModerationActions({
  currentFilter,
  deletedAt,
  fileName,
  moderationStatus,
  photoId,
  verificationStatus,
}: PhotoModerationActionsProps) {
  const [activeAction, setActiveAction] = useState<"approve" | "hide" | "delete" | null>(null);
  const [isPending, startTransition] = useTransition();
  const isDeleted = Boolean(deletedAt);
  const canApprove = !isDeleted && verificationStatus === "verified" && moderationStatus !== "approved";
  const canHide = !isDeleted && moderationStatus !== "hidden";
  const canDelete = !isDeleted;

  function runAction(action: "approve" | "hide" | "delete") {
    setActiveAction(action);
    startTransition(async () => {
      if (action === "approve") {
        await approvePhotoUploadAction(photoId, currentFilter);
        return;
      }

      if (action === "hide") {
        await hidePhotoUploadAction(photoId, currentFilter);
        return;
      }

      await deletePhotoUploadAction(photoId, currentFilter);
    });
  }

  if (!canApprove && !canHide && !canDelete) {
    return <p className="text-sm text-zinc-500">No actions available for deleted photos.</p>;
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <button
        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canApprove || isPending}
        onClick={() => runAction("approve")}
        type="button"
      >
        {isPending && activeAction === "approve" ? "Approving..." : "Approve"}
      </button>
      <button
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canHide || isPending}
        onClick={() => runAction("hide")}
        type="button"
      >
        {isPending && activeAction === "hide" ? "Hiding..." : "Hide"}
      </button>
      <button
        className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canDelete || isPending}
        onClick={() => {
          if (!confirm(`Delete ${fileName}? This tombstones the upload and removes storage objects when available.`)) {
            return;
          }

          runAction("delete");
        }}
        type="button"
      >
        {isPending && activeAction === "delete" ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
