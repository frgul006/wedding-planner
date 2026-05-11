"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isRecord } from "@/lib/type-guards";
import type {
  HubFeedItem,
  HubGalleryPhoto,
  HubPhotoData,
} from "@/lib/wedding-hub-photo-verification";
import { MAX_HUB_FILES_PER_REQUEST, MAX_PHOTO_NOTE_LENGTH } from "@/lib/wedding-hub-photo-upload";
import type { HubContext } from "@/lib/wedding-hub-photo";
import { getMonogram, type HubWedding } from "@/lib/wedding-hub";

type UploadIntent = {
  clientId: string;
  uploadPath: string;
  uploadUrl: string;
  uploadToken: string | null;
  signedUploadClaim: string;
  mimeType: string;
  sizeBytes: number;
  canGenerateThumbnail: boolean;
  thumbnailPath?: string;
  thumbnailUploadUrl?: string;
  thumbnailToken?: string;
  thumbnailClaim?: string;
};

type SelectedPhoto = {
  id: string;
  file: File;
  fileName: string;
  previewUrl: string;
  note: string;
  status:
    | "queued"
    | "preparing"
    | "uploading"
    | "finalizing"
    | "done"
    | "error"
    | "rejected";
  progress: number;
  message: string;
  signedUploadClaim?: string;
  thumbnailBlobUrl?: string;
  thumbnailFile?: File;
};

type WeddingHubClientProps = {
  context: HubContext | null;
  wedding: HubWedding;
  initialPhotoData: HubPhotoData;
  spotifyEnabled: boolean;
};

function canUploadFile(file: File) {
  return ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type);
}

function readableFileError(fileCount: number, maxFiles: number) {
  return `${fileCount}/${maxFiles} bilder valda`;
}

function isAllowedThumbnailType(mimeType: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}

async function generateThumbnail(file: File) {
  if (!isAllowedThumbnailType(file.type)) {
    return null;
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const maxSide = 320;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.82);
      return;
    }

    resolve(null);
  });

  if (!blob) {
    return null;
  }

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    fileName: `${crypto.randomUUID()}.jpg`,
  };
}

function uploadToSignedUrl(uploadUrl: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();

    body.append("cacheControl", "3600");
    body.append("", file);

    request.open("PUT", uploadUrl, true);
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }

      reject(new Error(`Upload failed (${request.status})`));
    };

    request.onerror = () => reject(new Error("Upload failed"));
    request.send(body);
  });
}

export function WeddingHubClient({
  context,
  wedding,
  initialPhotoData,
  spotifyEnabled,
}: WeddingHubClientProps) {
  const [activeTab, setActiveTab] = useState<"flow" | "gallery">("flow");
  const [photos, setPhotos] = useState<HubGalleryPhoto[]>(initialPhotoData.photos.photos);
  const [feed, setFeed] = useState<HubFeedItem[]>(initialPhotoData.feed);
  const [photoCount, setPhotoCount] = useState<number>(initialPhotoData.photos.totalPhotoCount);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingAll, setIsUploadingAll] = useState(false);

  const parsePhotoData = (value: unknown): HubPhotoData | null => {
    if (!isRecord(value)) {
      return null;
    }

    const photosBlock = value.photos;
    const feedBlock = value.feed;

    if (
      !isRecord(photosBlock) ||
      !Array.isArray(photosBlock.photos) ||
      typeof photosBlock.totalPhotoCount !== "number" ||
      !Array.isArray(feedBlock)
    ) {
      return null;
    }

    const photos = photosBlock.photos;
    const feed = feedBlock;

    const parsedPhotos: HubGalleryPhoto[] = [];

    for (const rawPhoto of photos) {
      if (
        !isRecord(rawPhoto) ||
        typeof rawPhoto.id !== "string" ||
        typeof rawPhoto.uploadedAt !== "string" ||
        typeof rawPhoto.who !== "string" ||
        (rawPhoto.note !== null && typeof rawPhoto.note !== "string") ||
        typeof rawPhoto.photoUrl !== "string" ||
        typeof rawPhoto.thumbnailUrl !== "string"
      ) {
        return null;
      }

      parsedPhotos.push({
        id: rawPhoto.id,
        uploadedAt: rawPhoto.uploadedAt,
        who: rawPhoto.who,
        note: rawPhoto.note === null ? null : rawPhoto.note,
        photoUrl: rawPhoto.photoUrl,
        thumbnailUrl: rawPhoto.thumbnailUrl,
      });
    }

    const parsedFeed: HubFeedItem[] = [];

    for (const rawFeed of feed) {
      if (
        !isRecord(rawFeed) ||
        typeof rawFeed.id !== "string" ||
        typeof rawFeed.when !== "string" ||
        typeof rawFeed.who !== "string" ||
        (rawFeed.caption !== null && typeof rawFeed.caption !== "string") ||
        typeof rawFeed.photoUrl !== "string" ||
        typeof rawFeed.thumbnailUrl !== "string"
      ) {
        return null;
      }

      parsedFeed.push({
        id: rawFeed.id,
        when: rawFeed.when,
        who: rawFeed.who,
        caption: rawFeed.caption === null ? null : rawFeed.caption,
        photoUrl: rawFeed.photoUrl,
        thumbnailUrl: rawFeed.thumbnailUrl,
      });
    }

    return {
      photos: {
        totalPhotoCount: photosBlock.totalPhotoCount,
        photos: parsedPhotos,
      },
      feed: parsedFeed,
    };
  };

  const parseUploadIntents = (value: unknown): UploadIntent[] | null => {
    if (!Array.isArray(value)) {
      return null;
    }

    const out: UploadIntent[] = [];

    for (const raw of value) {
      if (!isRecord(raw)) {
        return null;
      }

      const uploadUrl = typeof raw.uploadUrl === "string" ? raw.uploadUrl : "";
      const clientId = typeof raw.clientId === "string" ? raw.clientId : "";
      const signedUploadClaim = typeof raw.signedUploadClaim === "string" ? raw.signedUploadClaim : "";

      if (!uploadUrl || !clientId || !signedUploadClaim || typeof raw.mimeType !== "string") {
        return null;
      }

      out.push({
        clientId,
        uploadPath: typeof raw.uploadPath === "string" ? raw.uploadPath : "",
        uploadUrl,
        uploadToken: typeof raw.uploadToken === "string" || raw.uploadToken === null ? raw.uploadToken : null,
        signedUploadClaim,
        mimeType: String(raw.mimeType),
        sizeBytes: typeof raw.sizeBytes === "number" ? raw.sizeBytes : 0,
        canGenerateThumbnail: raw.canGenerateThumbnail === true,
        thumbnailPath: typeof raw.thumbnailPath === "string" ? raw.thumbnailPath : undefined,
        thumbnailUploadUrl: typeof raw.thumbnailUploadUrl === "string" ? raw.thumbnailUploadUrl : undefined,
        thumbnailToken: typeof raw.thumbnailToken === "string" ? raw.thumbnailToken : undefined,
        thumbnailClaim: typeof raw.thumbnailClaim === "string" ? raw.thumbnailClaim : undefined,
      });
    }

    return out;
  };

  const parseFinalizeRows = (value: unknown): Array<{
    clientId: string;
    success: boolean;
    status: string;
    reason?: string | null;
  }> | null => {
    if (!isRecord(value)) {
      return null;
    }

    const rawResults = value.results;
    if (!Array.isArray(rawResults)) {
      return null;
    }

    const results: Array<{ clientId: string; success: boolean; status: string; reason?: string | null }> = [];

    const finalizeRows = rawResults;

    for (const row of finalizeRows) {
      if (!isRecord(row)) {
        return null;
      }

      const clientId = typeof row.clientId === "string" ? row.clientId : "";
      const success = typeof row.success === "boolean" ? row.success : false;
      const status = typeof row.status === "string" ? row.status : "error";

      if (!clientId || !status) {
        return null;
      }

      results.push({
        clientId,
        success,
        status,
        reason: row.reason === null ? null : typeof row.reason === "string" ? row.reason : undefined,
      });
    }

    return results;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const canUpload = Boolean(context?.uploadAllowed);
  const reviewCopy = wedding.photo_upload_requires_review
    ? "Bilderna läggs först i granskning och visas när de har godkänts."
    : "Bilderna visas i flödet efter teknisk verifiering.";
  const uploadBanner = useMemo(() => {
    if (context?.uploadAllowed) {
      return "Ladda upp dina bilder här."
    }

    if (wedding.allow_anonymous_hub_upload) {
      return "Gästinloggning saknas."
    }

    return "Anonym uppladdning är stängd. Logga in med en aktiv inbjudningslänk för att kunna ladda upp.";
  }, [context?.uploadAllowed, wedding.allow_anonymous_hub_upload]);

  const refreshGallery = useCallback(async () => {
    const response = await fetch("/api/wedding-hub/photos");
    if (!response.ok) {
      return;
    }

    const rawPayload = await response.json();
    const nextPhotoData = parsePhotoData(rawPayload);

    if (!nextPhotoData) {
      return;
    }

    setPhotos(nextPhotoData.photos.photos);
    setPhotoCount(nextPhotoData.photos.totalPhotoCount ?? nextPhotoData.photos.photos.length);
    setFeed(nextPhotoData.feed);
  }, []);

  useEffect(() => {
    setPhotos(initialPhotoData.photos.photos);
    setFeed(initialPhotoData.feed);
    setPhotoCount(initialPhotoData.photos.totalPhotoCount);
  }, [initialPhotoData.photos.photos, initialPhotoData.feed, initialPhotoData.photos.totalPhotoCount]);

  const onSelectFiles = useCallback((nextFiles: FileList | null) => {
    if (!nextFiles) {
      return;
    }

    const next: SelectedPhoto[] = [];
    const remainingSlots = Math.max(0, MAX_HUB_FILES_PER_REQUEST - selectedPhotos.length);

    if (remainingSlots === 0) {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const usable = Array.from(nextFiles).filter((file) => canUploadFile(file));
    const normalized = usable.slice(0, remainingSlots);

    for (const file of normalized) {
      if (file.size < 1) {
        continue;
      }

      const id = crypto.randomUUID();
      const state: SelectedPhoto = {
        id,
        file,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        note: "",
        status: "queued",
        progress: 0,
        message: "Klar",
      };

      next.push(state);
      void generateThumbnail(file).then((thumbnail) => {
        if (!thumbnail) {
          return;
        }

        setSelectedPhotos((current) =>
          current.map((existing) =>
            existing.id === id
              ? {
                  ...existing,
                  thumbnailBlobUrl: thumbnail.previewUrl,
                  thumbnailFile: new File([thumbnail.blob], thumbnail.fileName, { type: "image/jpeg" }),
                }
              : existing,
          ),
        );
      }).catch(() => undefined);
    }

    setSelectedPhotos((current) => [...current, ...next].slice(0, MAX_HUB_FILES_PER_REQUEST));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [selectedPhotos.length]);

  const onSelectFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const clearFile = useCallback((id: string) => {
    setSelectedPhotos((current) => {
      const entry = current.find((row) => row.id === id);
      if (entry?.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
      if (entry?.thumbnailBlobUrl) {
        URL.revokeObjectURL(entry.thumbnailBlobUrl);
      }

      return current.filter((row) => row.id !== id);
    });
  }, []);

  const updateSelected = useCallback(
    (id: string, mutate: (row: SelectedPhoto) => SelectedPhoto) => {
      setSelectedPhotos((current) => current.map((row) => (row.id === id ? mutate(row) : row)));
    },
    [],
  );

  const onUpload = useCallback(async () => {
    if (!canUpload || isUploadingAll || !selectedPhotos.length) {
      return;
    }

    if (selectedPhotos.length > MAX_HUB_FILES_PER_REQUEST) {
      return;
    }

    setIsUploadingAll(true);
    setIsUploading(true);

    try {
      setSelectedPhotos((current) =>
        current.map((row) => ({ ...row, status: "preparing", progress: 0, message: "Skapar uppladdning", signedUploadClaim: undefined })),
      );

      const signResponse = await fetch("/api/wedding-hub/photos/sign", {
        body: JSON.stringify({
          uploads: selectedPhotos.map((row) => ({
            clientId: row.id,
            fileName: row.fileName,
            mimeType: row.file.type,
            sizeBytes: row.file.size,
            note: row.note,
          })),
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });

      const signedResult = await signResponse.json().catch(() => null);
      const intents = parseUploadIntents(signedResult?.uploadIntents);

      if (!signResponse.ok || !intents) {
        throw new Error("upload_sign_failed");
      }

      const intentById = new Map(intents.map((intent) => [intent.clientId, intent]));
      const finalizeRows: Array<{
        clientId: string;
        originalClaim: string;
        originalFileName: string;
        note: string;
        thumbnailClaim?: string;
      }> = [];

      for (const item of selectedPhotos) {
        const intent = intentById.get(item.id);
        if (!intent) {
          updateSelected(item.id, (row) => ({ ...row, status: "error", message: "Ingen signatur" }));
          continue;
        }

        updateSelected(item.id, (row) => ({ ...row, status: "uploading", message: "Laddar upp", progress: 1 }));

        try {
          await uploadToSignedUrl(intent.uploadUrl, item.file, (progress) => {
            updateSelected(item.id, (row) => ({ ...row, progress, message: `Laddar upp ${progress}%` }));
          });

          let thumbnailClaim = undefined;

          if (intent.canGenerateThumbnail && item.thumbnailFile && intent.thumbnailUploadUrl) {
            const thumbnailIntent = {
              uploadUrl: intent.thumbnailUploadUrl,
              file: item.thumbnailFile,
            } as const;

            try {
              await uploadToSignedUrl(thumbnailIntent.uploadUrl, thumbnailIntent.file, () => undefined);
              thumbnailClaim = intent.thumbnailClaim;
            } catch {
              thumbnailClaim = undefined;
            }
          }

          finalizeRows.push({
            clientId: item.id,
            originalClaim: intent.signedUploadClaim,
            originalFileName: item.fileName,
            note: item.note,
            ...(thumbnailClaim ? { thumbnailClaim } : {}),
          });

          updateSelected(item.id, (row) => ({ ...row, status: "finalizing", message: "Verifierar", progress: 100 }));
        } catch (error) {
          updateSelected(item.id, (row) => ({
            ...row,
            status: "error",
            message: error instanceof Error ? error.message : "Uppladdning misslyckades",
          }));
        }
      }

      if (finalizeRows.length > 0) {
        const finalize = await fetch("/api/wedding-hub/photos/finalize", {
          body: JSON.stringify({ uploads: finalizeRows }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });

        const finalizePayload = await finalize.json().catch(() => null);
        const finalizeRowsResult = parseFinalizeRows(finalizePayload);

        if (finalize.ok && finalizeRowsResult) {
          for (const row of finalizeRowsResult) {
            const status = row.success ? "done" : row.status === "rejected" ? "rejected" : "error";

            updateSelected(row.clientId, (current) => ({
              ...current,
              status: status as SelectedPhoto["status"],
              message: row.success
                ? wedding.photo_upload_requires_review
                  ? "Skickad för granskning"
                  : "Verifierad"
                : row.reason
                  ? row.reason
                  : row.status,
            }));
          }

          await refreshGallery();
          setSelectedPhotos((current) => current.filter((item) => item.status !== "done"));
        } else {
          const failedClientIds = new Set(finalizeRows.map((row) => row.clientId));
          setSelectedPhotos((current) =>
            current.map((row) =>
              failedClientIds.has(row.id)
                ? { ...row, status: "error", message: "Verifiering misslyckades" }
                : row,
            ),
          );
        }
      }

    } catch (error) {
      setSelectedPhotos((current) =>
        current.map((row) => ({ ...row, status: "error", message: error instanceof Error ? error.message : "Uppladdning misslyckades" })),
      );
    } finally {
      setIsUploading(false);
      setIsUploadingAll(false);
    }
  }, [canUpload, isUploadingAll, refreshGallery, selectedPhotos, updateSelected, wedding.photo_upload_requires_review]);

  const dateBadge = wedding.wedding_date
    ? new Intl.DateTimeFormat("sv-SE", {
        day: "numeric",
        month: "short",
      })
        .format(new Date(wedding.wedding_date))
        .replace(".", "")
        .toLocaleUpperCase("sv-SE")
    : "BRÖLLOPSHUBB";

  return (
    <main className="min-h-dvh bg-[#f1eadc] pb-28 text-[#15130f]" style={{
      backgroundImage:
        "radial-gradient(rgba(21,19,15,0.045) 1px, transparent 1.4px), radial-gradient(rgba(179,74,44,0.045) 1px, transparent 1.6px)",
      backgroundSize: "5px 5px, 11px 11px",
    }}>
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col shadow-[0_0_0_1px_rgba(21,19,15,0.08)]">
        <header className="flex items-center justify-between border-b border-[#15130f]/15 px-5 py-4">
          <p className="font-serif text-2xl italic tracking-tight text-[#6f4f33]">
            {getMonogram(wedding.name)}
          </p>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-[#6b6358]">
            Bröllopshub · {dateBadge}
          </p>
        </header>

        <section className="px-6 pb-4 pt-8 text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.4em] text-[#6f4f33]">{wedding.name}</p>
          <h1 className="mt-4 font-serif text-5xl leading-[0.95] tracking-tight">
            Lägg till en <span className="italic text-[#b34a2c]">låt</span>
            <br />
            eller en <span className="italic text-[#b34a2c]">bild</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#6b6358]">{uploadBanner}</p>
        </section>

        <section className="grid grid-cols-2 gap-3 px-5 py-3">
          <button
            aria-label="Ladda upp bilder"
            className={`min-h-34 flex min-w-0 flex-col items-center justify-center gap-3 border px-4 py-6 text-center disabled:cursor-not-allowed ${
              canUpload ? "bg-[#15130f] text-[#f1eadc]" : "cursor-not-allowed bg-[#15130f]/70 text-[#f1eadc]/80"
            }`}
            onClick={onSelectFileClick}
            disabled={!canUpload}
            type="button"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current text-2xl">↑</span>
            <span className="font-serif text-3xl italic leading-none">Bilder</span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.28em]">{canUpload ? "Ladda upp" : "Lås"}</span>
          </button>

          <a
            className={`border px-4 py-6 text-center font-mono text-[0.65rem] uppercase tracking-[0.28em] ${
              spotifyEnabled ? "text-[#15130f]" : "text-[#15130f]/50"
            } border-[#15130f]/30`}
            href={spotifyEnabled ? wedding.spotify_playlist_url ?? "" : undefined}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-full border border-current text-2xl">♪</span>
            <span className="font-serif text-3xl italic leading-none">Spellista</span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.28em]">{spotifyEnabled ? "Öppna" : "Saknas"}</span>
          </a>
        </section>

        <p className="mx-5 my-2 border-l-2 border-[#b34a2c] bg-[#b34a2c]/5 px-3 py-2 font-serif text-sm italic text-[#b34a2c]">
          {canUpload
            ? reviewCopy
            : "Gästuppladdning är avstängd. Använd en aktiv inbjudningssida för uppladdning."}
        </p>

        <section className="mt-3 grid grid-cols-2 border-y border-[#15130f]/15 px-5">
          <div className="py-3 text-center">
            <p className="font-serif text-3xl leading-none">{photoCount}</p>
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.32em] text-[#6b6358]">Bilder</p>
          </div>
          <div className="border-l border-[#15130f]/15 py-3 text-center">
            <p className="font-serif text-3xl leading-none">{context?.wedding?.photo_upload_requires_review ? "⧖" : "✶"}</p>
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.32em] text-[#6b6358]">Visning</p>
          </div>
        </section>

        {selectedPhotos.length ? (
          <section className="px-5 py-3">
            <p className="mb-2 font-mono text-sm uppercase tracking-[0.22em] text-[#6f4f33]">Valda filer</p>
            <div className="grid gap-2">
              {selectedPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border border-[#15130f]/20 bg-[#f5efe3] px-2 py-2"
                >
                  <img
                    alt="Miniatur"
                    className="h-14 w-14 object-cover"
                    src={photo.thumbnailBlobUrl ?? photo.previewUrl}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{photo.fileName}</p>
                    <input
                      className="mt-1 w-full rounded border border-[#15130f]/30 px-2 py-1 text-xs"
                      maxLength={MAX_PHOTO_NOTE_LENGTH}
                      onChange={(event) => {
                        const note = event.target.value;
                        updateSelected(photo.id, (row) => ({ ...row, note }));
                      }}
                      placeholder="Lägg till kommentar"
                      type="text"
                      value={photo.note}
                    />
                    <p className="mt-1 text-xs text-[#6b6358]">{photo.message}</p>
                    {isUploading ? <p className="mt-1 text-[11px] text-[#6f4f33]">{photo.progress}%</p> : null}
                  </div>
                  <button
                    className="rounded border border-[#15130f]/20 px-2 py-2 text-xs"
                    onClick={() => {
                      clearFile(photo.id);
                    }}
                    type="button"
                  >
                    Ta bort
                  </button>
                </div>
              ))}
            </div>
            <button
              className="mt-3 w-full border border-[#15130f] bg-[#15130f] px-3 py-3 text-sm font-semibold text-[#f1eadc] disabled:opacity-60"
              disabled={!canUpload || isUploadingAll}
              onClick={onUpload}
              type="button"
            >
              {isUploadingAll ? "Laddar upp..." : `Ladda upp ${readableFileError(selectedPhotos.length, MAX_HUB_FILES_PER_REQUEST)}`}
            </button>
          </section>
        ) : null}

        <section className="mt-3 grid grid-cols-2 border-b border-[#15130f]/15 px-5" aria-label="Hub views">
          <button
            className={`border-b-2 px-2 py-4 text-center font-mono text-[0.7rem] font-semibold uppercase tracking-[0.28em] ${
              activeTab === "flow" ? "border-[#b34a2c]" : "border-transparent text-[#6b6358]"
            }`}
            onClick={() => setActiveTab("flow")}
            type="button"
          >
            Flöde
          </button>
          <button
            className={`border-b-2 px-2 py-4 text-center font-mono text-[0.7rem] font-semibold uppercase tracking-[0.28em] ${
              activeTab === "gallery" ? "border-[#b34a2c]" : "border-transparent text-[#6b6358]"
            }`}
            onClick={() => setActiveTab("gallery")}
            type="button"
          >
            Galleriet
          </button>
        </section>

        <section className="flex flex-1 flex-col px-5 py-6">
          {activeTab === "flow" ? (
            feed.length > 0 ? (
              <div className="grid gap-3">
                {feed.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[2.75rem_1fr] gap-3 border-b border-[#15130f]/20 pb-4">
                    <img
                      src={entry.thumbnailUrl}
                      alt=""
                      className="h-11 w-11 border border-[#15130f]/20 bg-[#e6dcc7] object-cover"
                    />
                    <div>
                      <p className="text-sm font-medium">
                        {entry.who} laddade upp en bild
                        {entry.caption ? <> — “{entry.caption}”</> : null}
                      </p>
                      <span className="mt-1 block font-mono text-[0.65rem] uppercase tracking-[0.22em] text-[#6b6358]">{entry.when}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-none border border-[#15130f]/15 bg-[#f1eadc]/70 p-4">
                <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.32em]">Inga nya bidrag än</h2>
                <p className="mt-1 text-sm leading-6 text-[#6b6358]">Dela din bild så visar vi den här efter godkännande.</p>
              </div>
            )
          ) : photos.length ? (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <a
                  key={photo.id}
                  className="block h-28 w-full"
                  href={photo.photoUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <img
                    alt={`Foto från ${photo.who}`}
                    className="h-full w-full object-cover"
                    src={photo.thumbnailUrl}
                  />
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-none border border-[#15130f]/15 bg-[#f1eadc]/70 p-4">
              <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.32em]">Galleriet är tomt</h2>
              <p className="mt-1 text-sm leading-6 text-[#6b6358]">Bli först med att ladda upp en bild.</p>
            </div>
          )}
        </section>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t-2 border-[#b34a2c] bg-[#15130f]/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
          <button
            className="bg-[#b34a2c] px-3 py-4 text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.28em] text-[#f1eadc] disabled:opacity-65"
            disabled={!canUpload || isUploading}
            onClick={selectedPhotos.length > 0 ? onUpload : onSelectFileClick}
            type="button"
          >
            {selectedPhotos.length > 0 ? "↑ Ladda upp" : "↑ Välj bilder"}
          </button>
          {spotifyEnabled ? (
            <a
              className="border border-white/25 px-3 py-4 text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.28em] text-[#f1eadc] no-underline"
              href={wedding.spotify_playlist_url ?? ""}
              rel="noopener noreferrer"
              target="_blank"
            >
              ♪ Lägg till låt
            </a>
          ) : (
            <button className="border border-white/25 px-3 py-4 text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.28em] text-[#f1eadc] opacity-65" type="button" disabled>
              ♪ Saknas
            </button>
          )}
        </div>
      </div>

      <input
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        multiple
        onChange={(event) => {
          onSelectFiles(event.target.files);
        }}
        ref={fileInputRef}
        type="file"
      />
    </main>
  );
}
