"use client";

import { useState } from "react";

export function QrCodeActions({ hubUrl }: { hubUrl: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyHubUrl() {
    try {
      await navigator.clipboard.writeText(hubUrl);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2500);
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <button
        className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
        onClick={copyHubUrl}
        type="button"
      >
        {copyStatus === "copied"
          ? "Kopierad"
          : copyStatus === "failed"
            ? "Kopiering misslyckades"
            : "Kopiera hubb-URL"}
      </button>
      <button
        className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
        onClick={() => window.print()}
        type="button"
      >
        Skriv ut QR-blad
      </button>
    </div>
  );
}
