"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

const refreshIntervalMs = 15_000;

export function PhotoListRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const refreshPhotos = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    const intervalId = window.setInterval(refreshPhotos, refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [refreshPhotos]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600 ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between">
      <span>Auto-refreshing every 15 seconds for new uploads.</span>
      <button
        className="rounded-full border border-zinc-300 px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onClick={refreshPhotos}
        type="button"
      >
        {isPending ? "Refreshing..." : "Refresh now"}
      </button>
    </div>
  );
}
