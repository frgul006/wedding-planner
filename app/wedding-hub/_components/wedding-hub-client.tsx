"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_HUB_FILES_PER_REQUEST,
  MAX_PHOTO_NOTE_LENGTH,
  PHOTO_UPLOAD_ALLOWED_MIME_TYPES,
  PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES,
  PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES,
} from "@/lib/photo-upload";
import { isRecord } from "@/lib/type-guards";
import type {
  FinalizeRequestItem,
  HubFeedItem,
  HubGalleryPhoto,
  HubPhotoData,
} from "@/lib/wedding-hub-photo-verification";
import type { HubContext } from "@/lib/wedding-hub-access";
import type { HubWedding } from "@/lib/wedding-hub";
import { getPublicPartnerNames, getWeddingHubDisplay } from "@/lib/wedding-settings-display";
import { HubPhotoViewer } from "./hub-photo-viewer";
import { LivingCamera, SingingNote } from "./hub-action-characters";
import motion from "./wedding-hub-motion.module.css";

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
  // Preserve completed Storage transfers across uncertain finalize responses.
  finalizeUpload?: FinalizeRequestItem;
  thumbnailBlobUrl?: string;
  thumbnailFile?: File;
};

type WeddingHubClientProps = {
  context: HubContext | null;
  wedding: HubWedding;
  initialPhotoData: HubPhotoData;
};

const PHOTO_UPLOAD_ALLOWED_MIME_TYPE_SET = new Set<string>(PHOTO_UPLOAD_ALLOWED_MIME_TYPES);
const PHOTO_UPLOAD_THUMBNAIL_MIME_TYPE_SET = new Set<string>(PHOTO_UPLOAD_THUMBNAIL_MIME_TYPES);
const PHOTO_UPLOAD_ACCEPT = PHOTO_UPLOAD_ALLOWED_MIME_TYPES.join(",");
const READABLE_ALLOWED_IMAGE_TYPES = "JPG, PNG, WEBP, HEIC eller HEIF";

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function validateUploadFile(file: File) {
  const fileName = file.name || "Filen";

  if (file.size < 1) {
    return `${fileName} är tom och kan inte laddas upp.`;
  }

  if (file.size > PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES) {
    return `${fileName} är för stor. Välj en bild under ${formatMegabytes(PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES)}.`;
  }

  if (!PHOTO_UPLOAD_ALLOWED_MIME_TYPE_SET.has(file.type)) {
    return `${fileName} har en filtyp som inte stöds. Välj ${READABLE_ALLOWED_IMAGE_TYPES}.`;
  }

  return null;
}

function isAllowedThumbnailType(mimeType: string) {
  return PHOTO_UPLOAD_THUMBNAIL_MIME_TYPE_SET.has(mimeType);
}

function uploadErrorMessage(errorCode: unknown, status: number) {
  if (status === 403) {
    return "Uppladdning är avstängd för den här gästen. Öppna en aktiv inbjudningslänk och försök igen.";
  }

  switch (errorCode) {
    case "unsupported_mime":
      return `Filtypen stöds inte. Välj ${READABLE_ALLOWED_IMAGE_TYPES}.`;
    case "invalid_file_size":
      return `Filen är tom eller för stor. Välj en bild mellan 1 byte och ${formatMegabytes(PHOTO_UPLOAD_MAX_FILE_SIZE_BYTES)}.`;
    case "invalid_file_count":
      return `Du kan ladda upp högst ${MAX_HUB_FILES_PER_REQUEST} bilder åt gången.`;
    case "invalid_note_length":
      return `Kommentaren får vara högst ${MAX_PHOTO_NOTE_LENGTH} tecken.`;
    case "invalid_client_payload":
    case "invalid_payload":
      return "Något i filvalet kunde inte läsas. Välj bilderna igen och försök på nytt.";
    default:
      return "Kunde inte förbereda uppladdningen. Kontrollera filerna och försök igen.";
  }
}

function PhotoPreview({ src, alt, sizes, fallbackLabel = "Förhandsvisning saknas" }: { src: string; alt: string; sizes: string; fallbackLabel?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return failedSource === src ? (
    <span className="flex h-full items-center justify-center bg-[#e6dcc7] p-1 text-center text-[10px] leading-tight text-[#6f4f33]" title="Förhandsvisning saknas i den här webbläsaren.">
      {fallbackLabel}
    </span>
  ) : (
    <Image alt={alt} className="object-cover" fill sizes={sizes} src={src} unoptimized onError={() => setFailedSource(src)} />
  );
}

function HubPhotoIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" />
    </svg>
  );
}

function WeddingRings() {
  return (
    <svg aria-hidden="true" className={motion.rings} width="36" height="28" viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="14" cy="18" r="8" />
      <circle cx="25" cy="18" r="8" />
      <path d="m28 4 3 3-4 3-2-4Z" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyPhotos({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[#15130f]/10 bg-[#f7f2ea]/65 px-5 py-7 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#b79d7a]/45 text-[#76543c]"><HubPhotoIcon /></span>
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-64 text-sm leading-6 text-[#6b6358]">{children}</p>
    </div>
  );
}

function revokeSelectedPhotoUrls(photo: Pick<SelectedPhoto, "previewUrl" | "thumbnailBlobUrl">) {
  URL.revokeObjectURL(photo.previewUrl);

  if (photo.thumbnailBlobUrl) {
    URL.revokeObjectURL(photo.thumbnailBlobUrl);
  }
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
}: WeddingHubClientProps) {
  const hubDisplay = getWeddingHubDisplay(wedding);
  const [activeTab, setActiveTab] = useState<"flow" | "gallery">("flow");
  const [photoData, setPhotoData] = useState({ initial: initialPhotoData, live: initialPhotoData });
  // Reset on fresh server props without a cascading setState-in-effect render.
  if (photoData.initial !== initialPhotoData) {
    setPhotoData({ initial: initialPhotoData, live: initialPhotoData });
  }
  const photos = photoData.live.photos.photos;
  const feed = photoData.live.feed;
  const [viewer, setViewer] = useState<{ photoId: string; opener: HTMLButtonElement } | null>(null);
  const uploadQueueRef = useRef<HTMLElement>(null);
  const browseViewsRef = useRef<HTMLElement>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [fileSelectionMessage, setFileSelectionMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadInFlightRef = useRef(false);
  const galleryRequestRef = useRef(0);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);

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
  const primaryActionsRef = useRef<HTMLElement>(null);
  const selectedPhotosRef = useRef<SelectedPhoto[]>([]);
  const [isPrimaryActionsVisible, setIsPrimaryActionsVisible] = useState(true);

  const canUpload = Boolean(context?.uploadAllowed);
  const refreshGallery = useCallback(async () => {
    const requestId = ++galleryRequestRef.current;
    const response = await fetch("/api/wedding-hub/photos");
    if (!response.ok) {
      return;
    }

    const rawPayload = await response.json();
    const nextPhotoData = parsePhotoData(rawPayload);

    // A slower response from an earlier batch must not replace newer photos.
    if (!nextPhotoData || requestId !== galleryRequestRef.current) {
      return;
    }

    setPhotoData(current => ({ ...current, live: nextPhotoData }));
  }, []);

  useEffect(() => {
    if (selectedPhotos.length > selectedPhotosRef.current.length) {
      uploadQueueRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      uploadQueueRef.current?.focus({ preventScroll: true });
    }
    selectedPhotosRef.current = selectedPhotos;
  }, [selectedPhotos]);

  useEffect(() => {
    const node = primaryActionsRef.current;

    if (!node || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPrimaryActionsVisible(entry.isIntersecting && entry.intersectionRatio >= 0.5);
      },
      { threshold: 0.5 },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => () => {
    for (const photo of selectedPhotosRef.current) {
      revokeSelectedPhotoUrls(photo);
    }

    selectedPhotosRef.current = [];
  }, []);

  const onSelectFiles = useCallback((nextFiles: FileList | null) => {
    if (!canUpload || !nextFiles || uploadInFlightRef.current) {
      return;
    }

    const next: SelectedPhoto[] = [];
    const rejectedMessages: string[] = [];
    let skippedForLimit = 0;
    const remainingSlots = Math.max(0, MAX_HUB_FILES_PER_REQUEST - selectedPhotos.length);

    if (remainingSlots === 0) {
      setFileSelectionMessage(`Du kan välja högst ${MAX_HUB_FILES_PER_REQUEST} bilder åt gången. Ta bort en bild innan du väljer fler.`);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    for (const file of Array.from(nextFiles)) {
      const validationMessage = validateUploadFile(file);

      if (validationMessage) {
        rejectedMessages.push(validationMessage);
        continue;
      }

      if (next.length >= remainingSlots) {
        skippedForLimit += 1;
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
        message: "",
      };

      next.push(state);
      void generateThumbnail(file).then((thumbnail) => {
        if (!thumbnail) {
          return;
        }

        setSelectedPhotos((current) => {
          let attached = false;
          const updated = current.map((existing) => {
            if (existing.id !== id) {
              return existing;
            }

            attached = true;
            if (existing.thumbnailBlobUrl) {
              URL.revokeObjectURL(existing.thumbnailBlobUrl);
            }

            return {
              ...existing,
              thumbnailBlobUrl: thumbnail.previewUrl,
              thumbnailFile: new File([thumbnail.blob], thumbnail.fileName, { type: "image/jpeg" }),
            };
          });

          if (!attached) {
            URL.revokeObjectURL(thumbnail.previewUrl);
          }

          return updated;
        });
      }).catch(() => undefined);
    }

    const messages = rejectedMessages.slice(0, 3);
    const hiddenRejectedCount = rejectedMessages.length - messages.length;

    if (hiddenRejectedCount > 0) {
      messages.push(`${hiddenRejectedCount} fil(er) till kunde inte läggas till.`);
    }

    if (skippedForLimit > 0) {
      messages.push(`Du kan välja högst ${MAX_HUB_FILES_PER_REQUEST} bilder åt gången. ${skippedForLimit} fil(er) hoppades över.`);
    }

    setFileSelectionMessage(messages.length > 0 ? messages.join(" ") : null);
    setSelectedPhotos((current) => [...current, ...next].slice(0, MAX_HUB_FILES_PER_REQUEST));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [canUpload, selectedPhotos.length]);

  const onSelectFileClick = useCallback(() => {
    if (!canUpload || uploadInFlightRef.current) return;
    fileInputRef.current?.click();
  }, [canUpload]);

  const clearFile = useCallback((id: string) => {
    if (uploadInFlightRef.current) return;
    setSelectedPhotos((current) => {
      const entry = current.find((row) => row.id === id);
      if (entry) {
        revokeSelectedPhotoUrls(entry);
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
    if (!canUpload || uploadInFlightRef.current || !selectedPhotos.length || selectedPhotos.length > MAX_HUB_FILES_PER_REQUEST) return;

    uploadInFlightRef.current = true;
    setFileSelectionMessage(null);
    setUploadSummary(null);
    setIsUploading(true);
    let completed = 0;
    try {
      for (const item of selectedPhotos) {
        if (item.status === "done") continue;
        try {
          let finalizeUpload = item.finalizeUpload;
          if (!finalizeUpload) {
            updateSelected(item.id, row => ({ ...row, status: "preparing", progress: 0, message: "Skapar uppladdning" }));
            // Sign just before this transfer, not before waiting on earlier files.
            const signResponse = await fetch("/api/wedding-hub/photos/sign", {
              body: JSON.stringify({ uploads: [{
                clientId: item.id,
                fileName: item.fileName,
                mimeType: item.file.type,
                sizeBytes: item.file.size,
                note: item.note,
              }] }),
              headers: { "content-type": "application/json" },
              method: "POST",
            });
            const signedResult = await signResponse.json().catch(() => null);
            const intents = parseUploadIntents(signedResult?.uploadIntents);
            const intent = intents?.find(row => row.clientId === item.id);
            if (!signResponse.ok || !intent) {
              throw new Error(uploadErrorMessage(isRecord(signedResult) ? signedResult.error : null, signResponse.status));
            }

            updateSelected(item.id, row => ({ ...row, status: "uploading", message: "Laddar upp", progress: 1 }));
            await uploadToSignedUrl(intent.uploadUrl, item.file, progress => {
              updateSelected(item.id, row => ({ ...row, progress, message: `Laddar upp ${progress}%` }));
            });

            let thumbnailClaim: string | undefined;
            if (intent.canGenerateThumbnail && item.thumbnailFile && intent.thumbnailUploadUrl) {
              try {
                await uploadToSignedUrl(intent.thumbnailUploadUrl, item.thumbnailFile, () => undefined);
                thumbnailClaim = intent.thumbnailClaim;
              } catch {
                // Original remains usable when an optional thumbnail fails.
              }
            }
            finalizeUpload = {
              clientId: item.id,
              originalClaim: intent.signedUploadClaim,
              originalFileName: item.fileName,
              note: item.note,
              thumbnailClaim,
            };
            updateSelected(item.id, row => ({ ...row, finalizeUpload }));
          }

          // Finish this file before advancing. Retain its claim on uncertain
          // responses: retry uses server idempotency, never a second upload.
          updateSelected(item.id, row => ({ ...row, status: "finalizing", progress: 100, message: "Verifierar" }));
          const response = await fetch("/api/wedding-hub/photos/finalize", {
            body: JSON.stringify({ uploads: [finalizeUpload] }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          const results = parseFinalizeRows(await response.json().catch(() => null));
          const result = results?.find(row => row.clientId === item.id);
          if (!response.ok || !result) throw new Error("Verifiering misslyckades. Försök igen.");
          if (!result.success) {
            updateSelected(item.id, row => ({
              ...row,
              status: result.status === "rejected" ? "rejected" : "error",
              // Confirmed rejection purges the object; only this response permits a fresh upload.
              finalizeUpload: result.status === "rejected" ? undefined : row.finalizeUpload,
              message: result.reason === "invalid_claim"
                ? "Verifieringslänken har gått ut. Bilden kan redan vara mottagen; kontrollera med brudparet innan du laddar upp den igen."
                : result.reason ?? "Verifiering misslyckades. Försök igen.",
            }));
            continue;
          }
          completed += 1;
          updateSelected(item.id, row => ({ ...row, status: "done", message: wedding.photo_upload_requires_review ? "Skickad för granskning" : "Verifierad" }));
          const receipt = wedding.photo_upload_requires_review
            ? completed === 1 ? "bild skickad för granskning" : "bilder skickade för granskning"
            : completed === 1 ? "bild uppladdad" : "bilder uppladdade";
          setUploadSummary(`${completed} ${receipt}.`);
        } catch (error) {
          updateSelected(item.id, row => ({ ...row, status: "error", message: error instanceof Error ? error.message : "Uppladdning misslyckades" }));
        }
      }
    } finally {
      setSelectedPhotos(current => current.filter(item => {
        if (item.status !== "done") return true;
        revokeSelectedPhotoUrls(item);
        return false;
      }));
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
    // Refresh once, without blocking the next file/batch or undoing verified receipts.
    if (completed > 0) void refreshGallery().catch(() => undefined);
  }, [canUpload, refreshGallery, selectedPhotos, updateSelected, wedding.photo_upload_requires_review]);

  return (
    <main lang="sv" className="min-h-dvh bg-[#f1eadc] pb-[calc(7rem+env(safe-area-inset-bottom))] font-sans text-[#15130f] [&_button:enabled]:cursor-pointer [&_button]:touch-manipulation [&_a]:touch-manipulation [&_:where(:focus-visible)]:outline-2 [&_:where(:focus-visible)]:outline-offset-4 [&_:where(:focus-visible)]:outline-[#b34a2c]" style={{
      backgroundImage:
        "radial-gradient(rgba(21,19,15,0.025) 0.7px, transparent 1px), radial-gradient(rgba(179,74,44,0.02) 0.7px, transparent 1px)",
      backgroundSize: "5px 5px, 11px 11px",
    }}>
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col shadow-[0_0_0_1px_rgba(21,19,15,0.08)]">
        <header className="flex items-center justify-between gap-4 border-b border-[#15130f]/10 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <p className="flex shrink-0 items-center gap-2 font-serif text-2xl italic tracking-tight text-[#6f4f33]">
            {hubDisplay.monogram}
            <WeddingRings />
          </p>
          <p className="text-right font-mono text-[0.625rem] leading-5 uppercase tracking-[0.18em] text-[#6b6358]">
            Bröllopshub · {hubDisplay.dateBadge}
          </p>
        </header>

        <section className="px-5 pb-5 pt-8 text-center">
          <p className="text-balance break-words font-mono text-[0.625rem] leading-5 uppercase tracking-[0.25em] text-[#6f4f33]">{getPublicPartnerNames(wedding).displayName}</p>
          <h1 className="mt-4 font-serif text-[clamp(2.5rem,12.3vw,3rem)] leading-[1.02] tracking-tight">
            Lägg till en <span className="italic text-[#b34a2c]">låt</span>
            <br />
            eller en <span className="italic text-[#b34a2c]">bild</span>.
          </h1>
        </section>

        <section ref={primaryActionsRef} data-motion-active={isPrimaryActionsVisible && !isUploading} className={`${motion.actions} grid grid-cols-2 gap-3 px-5 pb-6 pt-2`}>
          <button
            aria-label="Ladda upp bilder"
            className={`${motion.uploadAction} ${motion.characterAction} flex min-h-52 min-w-0 flex-col items-center justify-center gap-2 rounded-xl px-1 pb-4 text-center text-[#15130f] transition-colors active:bg-[#e6dcc7]/60 disabled:cursor-not-allowed disabled:opacity-50`}
            onClick={onSelectFileClick}
            disabled={!canUpload || isUploading}
            type="button"
          >
            <LivingCamera />
            <span className="font-serif text-[clamp(1.5rem,7.7vw,1.875rem)] italic leading-none">Bilder</span>
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-[#6f4f33]">{canUpload ? "Ladda upp" : "Stängd"}</span>
          </button>

          <a
            aria-disabled={!hubDisplay.spotifyEnabled}
            className={`${motion.musicAction} ${motion.characterAction} flex min-h-52 min-w-0 flex-col items-center justify-center gap-2 rounded-xl px-1 pb-4 text-center text-[#15130f] transition-colors ${
              hubDisplay.spotifyEnabled ? "active:bg-[#e6dcc7]/60" : "opacity-50"
            }`}
            href={hubDisplay.spotifyEnabled ? hubDisplay.spotifyUrl ?? "" : undefined}
            rel="noopener noreferrer"
            target="_blank"
          >
            <SingingNote />
            <span className="whitespace-nowrap font-serif text-[clamp(1.5rem,7.7vw,1.875rem)] italic leading-none tracking-tight">Spellista</span>
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-[#6f4f33]">{hubDisplay.spotifyEnabled ? <>Öppna <span aria-hidden="true">↗</span><span className="sr-only"> i Spotify (ny flik)</span></> : "Saknas"}</span>
          </a>
        </section>

        {!canUpload ? (
          <p className="mx-5 my-2 border-l-2 border-[#b34a2c] bg-[#b34a2c]/5 px-3 py-2 font-serif text-sm italic text-[#b34a2c]">
            Gästuppladdning är avstängd. Använd en aktiv inbjudningssida för uppladdning.
          </p>
        ) : null}

        {fileSelectionMessage ? (
          <p className="mx-5 my-2 border-l-2 border-[#8a2b18] bg-[#8a2b18]/5 px-3 py-2 text-sm text-[#8a2b18]" role="alert">
            {fileSelectionMessage}
          </p>
        ) : null}

        {uploadSummary ? (
          <p className="mx-5 my-2 flex items-center gap-2 rounded border border-[#3f7250]/20 bg-[#3f7250]/5 px-4 py-3 text-sm text-[#3f7250]" role="status">
            <svg aria-hidden="true" className={motion.successHeart} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20S4 15 4 9.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8C20 15 12 20 12 20Z" />
              <path className={motion.heartSpark} d="m2 3 2 2m16 0 2-2M12 1v2" />
            </svg>
            {uploadSummary}
          </p>
        ) : null}

        {selectedPhotos.length ? (
          <section ref={uploadQueueRef} tabIndex={-1} aria-label="Valda filer" className="scroll-mt-4 px-5 py-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-2xl tracking-tight">Valda filer</h2>
              <p className="text-xs text-[#6b6358]">{selectedPhotos.length} av {MAX_HUB_FILES_PER_REQUEST} bilder</p>
            </div>
            {selectedPhotos.some(photo => photo.file.type === "image/heic" || photo.file.type === "image/heif") ? (
              <p className="mb-2 text-xs text-[#6b6358]">HEIC/HEIF kan sakna förhandsvisning i den här webbläsaren. Öppna originalet, eller välj JPEG för visning i fler webbläsare.</p>
            ) : null}
            <div className="grid gap-3">
              {selectedPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded border border-[#15130f]/15 bg-[#f7f2ea]/80 p-3"
                >
                  <a className="relative block h-14 w-14 overflow-hidden rounded-sm" href={photo.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Öppna original: ${photo.fileName}`}>
                    <PhotoPreview
                      alt="Miniatur"
                      fallbackLabel="Öppna original"
                      sizes="56px"
                      src={photo.thumbnailBlobUrl ?? photo.previewUrl}
                    />
                  </a>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{photo.fileName}</p>
                    <p className="mt-1 text-xs text-[#6b6358]">{photo.file.size < 1024 * 1024 ? `${Math.max(1, Math.round(photo.file.size / 1024))} KB` : `${(photo.file.size / (1024 * 1024)).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`}</p>
                  </div>
                  <button
                    className="min-h-11 rounded px-2 text-xs text-[#76543c] underline decoration-[#b79d7a] underline-offset-4 active:bg-[#e6dcc7] disabled:opacity-50"
                    onClick={() => clearFile(photo.id)}
                    disabled={isUploading}
                    type="button"
                  >
                    Ta bort
                  </button>
                  <div className="col-span-3 min-w-0">
                    <label className="mb-1.5 block text-xs text-[#6b6358]" htmlFor={`photo-note-${photo.id}`}>Kommentar <span className="text-[#6b6358]">(valfritt)</span><span className="sr-only"> för {photo.fileName}</span></label>
                    <input
                      id={`photo-note-${photo.id}`}
                      className="min-h-11 w-full scroll-mb-32 rounded border border-[#15130f]/20 bg-[#fffdf8]/70 px-3 py-2 text-base placeholder:text-[#6b6358] disabled:opacity-60"
                      maxLength={MAX_PHOTO_NOTE_LENGTH}
                      disabled={isUploading || Boolean(photo.finalizeUpload)}
                      onChange={(event) => {
                        if (uploadInFlightRef.current || photo.finalizeUpload) return;
                        const note = event.target.value;
                        updateSelected(photo.id, (row) => ({ ...row, note }));
                      }}
                      placeholder="Lägg till kommentar"
                      type="text"
                      value={photo.note}
                    />
                    {photo.message ? <p className={`mt-2 break-words text-xs leading-5 ${photo.status === "error" || photo.status === "rejected" ? "text-[#8a2b18]" : "text-[#6b6358]"}`}>{photo.message}</p> : null}
                    {isUploading ? <progress aria-label={`Uppladdning av ${photo.fileName}`} className="mt-2 block h-1 w-full overflow-hidden rounded-full accent-[#b34a2c]" max={100} value={photo.progress} /> : null}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="mt-3 min-h-12 w-full rounded border border-[#15130f] bg-[#15130f] px-3 py-3 text-sm font-semibold text-[#f1eadc] active:bg-[#302b22] disabled:opacity-60"
              disabled={!canUpload || isUploading}
              onClick={onUpload}
              type="button"
            >
              {isUploading ? "Laddar upp…" : `Ladda upp ${selectedPhotos.length} ${selectedPhotos.length === 1 ? "bild" : "bilder"}`}
            </button>
          </section>
        ) : null}

        <section ref={browseViewsRef} tabIndex={-1} className="mx-5 grid grid-cols-2 border-b border-[#15130f]/15" aria-label="Bildvyer">
          <button
            aria-pressed={activeTab === "flow"}
            className={`min-h-12 border-b-2 px-2 py-3 text-center font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.2em] transition-colors ${
              activeTab === "flow" ? "border-[#b34a2c] text-[#8f321d]" : "border-transparent text-[#6b6358]"
            }`}
            onClick={() => setActiveTab("flow")}
            type="button"
          >
            Flöde
          </button>
          <button
            aria-pressed={activeTab === "gallery"}
            className={`min-h-12 border-b-2 px-2 py-3 text-center font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.2em] transition-colors ${
              activeTab === "gallery" ? "border-[#b34a2c] text-[#8f321d]" : "border-transparent text-[#6b6358]"
            }`}
            onClick={() => setActiveTab("gallery")}
            type="button"
          >
            Galleriet
          </button>
        </section>

        <section className="flex flex-1 flex-col px-5 py-5">
          {activeTab === "flow" ? (
            feed.length > 0 ? (
              <div className="grid gap-4">
                {feed.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-3 border-b border-[#15130f]/10 pb-4 last:border-0">
                    <button
                      aria-label={`Öppna foto från ${entry.who}`}
                      className="relative block h-16 w-16 overflow-hidden rounded border border-[#15130f]/10 bg-[#e6dcc7] active:opacity-80"
                      data-photo-id={entry.id}
                      onClick={event => setViewer({ photoId: entry.id, opener: event.currentTarget })}
                      type="button"
                    >
                      <PhotoPreview src={entry.thumbnailUrl} alt="" sizes="64px" />
                    </button>
                    <div className="min-w-0 wrap-anywhere">
                      <p className="text-sm leading-5"><span className="font-medium">{entry.who}</span> <span className="text-[#6b6358]">laddade upp en bild</span></p>
                      <span className="mt-1 block font-mono text-[0.625rem] leading-4 uppercase tracking-[0.1em] text-[#6b6358]">{entry.when}</span>
                      {entry.caption ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#514b42]">{entry.caption}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPhotos title="Inga nya bidrag än">
                {wedding.photo_upload_requires_review
                  ? "Dela din bild så visar vi den här efter godkännande."
                  : "Dela din bild så visar vi den här direkt."}
              </EmptyPhotos>
            )
          ) : photos.length ? (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  aria-label={`Öppna foto från ${photo.who}`}
                  className="relative block aspect-square w-full overflow-hidden rounded border border-[#15130f]/10 bg-[#e6dcc7] active:opacity-80"
                  data-photo-id={photo.id}
                  onClick={event => setViewer({ photoId: photo.id, opener: event.currentTarget })}
                  type="button"
                >
                  <PhotoPreview
                    alt=""
                    sizes="(max-width: 448px) 33vw, 149px"
                    src={photo.thumbnailUrl}
                  />
                </button>
              ))}
            </div>
          ) : (
            <EmptyPhotos title="Galleriet är tomt">Bli först med att ladda upp en bild.</EmptyPhotos>
          )}
        </section>
      </section>

      {!isPrimaryActionsVisible && !viewer ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#f1eadc]/15 bg-[#15130f]/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgb(21_19_15/10%)] backdrop-blur">
          <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
            <button
              className="min-h-12 rounded bg-[#b34a2c] px-2 py-3 text-center font-mono text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[#f1eadc] active:bg-[#8f321d] disabled:opacity-65"
              disabled={!canUpload || isUploading}
              onClick={selectedPhotos.length > 0 ? onUpload : onSelectFileClick}
              type="button"
            >
              {isUploading ? "Laddar upp…" : selectedPhotos.length > 0 ? "↑ Ladda upp" : "↑ Välj bilder"}
            </button>
            {hubDisplay.spotifyEnabled ? (
              <a
                className="flex min-h-12 items-center justify-center rounded border border-white/25 px-2 py-3 text-center font-mono text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[#f1eadc] no-underline active:bg-white/10"
                href={hubDisplay.spotifyUrl ?? ""}
                rel="noopener noreferrer"
                target="_blank"
              >
                ♪ Lägg till låt
              </a>
            ) : (
              <button className="min-h-12 rounded border border-white/25 px-2 py-3 text-center font-mono text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[#f1eadc] opacity-65" type="button" disabled>
                ♪ Saknas
              </button>
            )}
          </div>
        </div>
      ) : null}

      {viewer ? (
        <HubPhotoViewer
          initialPhotoId={viewer.photoId}
          opener={viewer.opener}
          photos={photos}
          uploadDisabled={!canUpload || isUploading}
          onClose={() => {
            setViewer(null);
            if (!viewer.opener.isConnected) browseViewsRef.current?.focus({ preventScroll: true });
          }}
          onUpload={onSelectFileClick}
        />
      ) : null}

      <input
        accept={PHOTO_UPLOAD_ACCEPT}
        className="hidden"
        disabled={!canUpload || isUploading}
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
