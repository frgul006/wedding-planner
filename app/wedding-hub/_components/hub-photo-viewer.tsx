import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { HubGalleryPhoto } from "@/lib/wedding-hub-photo-verification";
import styles from "./hub-photo-viewer.module.css";

type HubPhotoViewerProps = {
  photos: HubGalleryPhoto[];
  initialPhotoId: string;
  opener: HTMLButtonElement;
  uploadDisabled: boolean;
  onClose: () => void;
  onUpload: () => void;
};

function ViewerImage({ photo }: { photo: HubGalleryPhoto }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  if (status === "error") {
    return <p className="flex h-full items-center justify-center px-6 text-center text-sm leading-6" role="status">Bilden kan inte visas här. Öppna originalet nedan, eller bläddra vidare.</p>;
  }
  return (
    <>
      {status === "loading" ? (
        <>
          {photo.thumbnailUrl !== photo.photoUrl ? <div aria-hidden="true" className="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-40" style={{ backgroundImage: `url(${JSON.stringify(photo.thumbnailUrl)})` }} /> : null}
          <p className="absolute inset-0 z-10 flex items-center justify-center" role="status"><span className="bg-[#15130f]/85 px-4 py-2 text-sm">Laddar bild…</span></p>
        </>
      ) : null}
      <Image
        alt={`Foto från ${photo.who}`}
        className="object-contain"
        draggable={false}
        fill
        loading="eager"
        sizes="100vw"
        src={photo.photoUrl}
        unoptimized
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />
    </>
  );
}

export function HubPhotoViewer({ photos, initialPhotoId, opener, uploadDisabled, onClose, onUpload }: HubPhotoViewerProps) {
  const [selectedId, setSelectedId] = useState(initialPhotoId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<() => void>(() => undefined);
  const gestureRef = useRef<{ x: number; y: number } | null>(null);
  const index = photos.findIndex(photo => photo.id === selectedId);
  const photo = photos[index];
  const hasPrevious = index > 0;
  const hasNext = index >= 0 && index < photos.length - 1;
  const photoId = photo?.id;

  useEffect(() => {
    if (captionRef.current) captionRef.current.scrollTop = 0;
    const dialog = dialogRef.current;
    // Refresh may remove the focused caption/original link. Keep keys in the modal.
    if (!photoId && dialog?.open && !dialog.contains(document.activeElement)) {
      closeButtonRef.current?.focus({ preventScroll: true });
    }
  }, [photoId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const saved = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow };
    // Fixed body also locks background scrolling on mobile Safari.
    Object.assign(body.style, { position: "fixed", top: `-${scrollY}px`, left: `-${scrollX}px`, width: "100%", overflow: "hidden" });
    dialog.showModal();
    closeButtonRef.current?.focus();
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      dialog.close();
      Object.assign(body.style, saved);
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      if (opener.isConnected) opener.focus({ preventScroll: true });
    };
    restoreRef.current = restore;
    return restore;
  }, [opener]);

  const close = () => {
    restoreRef.current();
    onClose();
  };
  const move = (direction: -1 | 1) => {
    if ((direction === -1 && !hasPrevious) || (direction === 1 && !hasNext)) return;
    setSelectedId(photos[index + direction].id);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="hub-photo-viewer-title"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-[#15130f] p-0 text-[#f1eadc] backdrop:bg-[#15130f]"
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => {
        if (event.key === "Tab") {
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]');
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className={`${styles.layout} flex h-full flex-col pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))]`}>
        <header className={`${styles.header} flex shrink-0 items-center justify-between gap-3 pb-3`}>
          <h2 id="hub-photo-viewer-title" className="font-serif text-2xl italic">Våra bilder</h2>
          <button ref={closeButtonRef} className="min-h-12 min-w-12 rounded-sm border border-[#f1eadc]/25 bg-white/5 px-4 text-sm active:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1eadc]" onClick={close} type="button">
            Stäng <span aria-hidden="true">×</span>
          </button>
        </header>

        <div
          className={`${styles.stage} relative min-h-0 flex-1 touch-pan-y touch-pinch-zoom overflow-hidden rounded-sm`}
          onTouchStart={event => {
            gestureRef.current = event.touches.length === 1 && (window.visualViewport?.scale ?? 1) <= 1
              ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
          }}
          onTouchMove={event => {
            const start = gestureRef.current;
            if (!start) return;
            if (event.touches.length !== 1) { gestureRef.current = null; return; }
            const dx = Math.abs(event.touches[0].clientX - start.x);
            const dy = Math.abs(event.touches[0].clientY - start.y);
            // Once vertical scrolling or a pinch starts, never turn it into navigation.
            if (dy > 8 && dy >= dx) gestureRef.current = null;
          }}
          onTouchCancel={() => { gestureRef.current = null; }}
          onTouchEnd={event => {
            const start = gestureRef.current;
            gestureRef.current = null;
            if (!start || event.touches.length || !event.changedTouches.length || (window.visualViewport?.scale ?? 1) > 1) return;
            const dx = event.changedTouches[0].clientX - start.x;
            const dy = event.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
          }}
        >
          {photo ? <ViewerImage key={photo.photoUrl} photo={photo} /> : (
            <p className="flex h-full items-center justify-center text-center" role="status">Bilden är inte längre tillgänglig. Stäng för att återgå till hubben.</p>
          )}
        </div>

        <footer className={`${styles.details} mx-auto w-full max-w-3xl shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3`}>
          {photo ? (
            <div ref={captionRef} className="max-h-[20dvh] overflow-y-auto overscroll-contain rounded-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#f1eadc]" tabIndex={0} aria-label="Bildtext">
              <p className="font-serif text-xl">{photo.who}</p>
              {photo.note ? <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#e6dcc7]">{photo.note}</p> : null}
            </div>
          ) : null}
          <div className="my-3 flex items-center justify-between gap-3">
            <button aria-label="Föregående bild" className="min-h-12 min-w-12 rounded-sm border border-[#f1eadc]/25 bg-white/5 px-4 text-xl active:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1eadc] aria-disabled:opacity-30" aria-disabled={!hasPrevious} onClick={() => move(-1)} type="button">←</button>
            <p className="text-center font-mono text-xs text-[#e6dcc7]" aria-live="polite" aria-atomic="true">{photo ? `Bild ${index + 1} av ${photos.length}` : "Ingen bild"}</p>
            <button aria-label="Nästa bild" className="min-h-12 min-w-12 rounded-sm border border-[#f1eadc]/25 bg-white/5 px-4 text-xl active:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1eadc] aria-disabled:opacity-30" aria-disabled={!hasNext} onClick={() => move(1)} type="button">→</button>
          </div>
          <div className={`${styles.actions} grid grid-cols-1 items-center gap-x-4 gap-y-1 min-[480px]:grid-cols-[minmax(0,1fr)_auto]`}>
            <button
              className="min-h-12 min-w-0 rounded-sm bg-[#b34a2c] px-4 py-3 font-mono text-xs font-semibold uppercase tracking-[0.06em] active:bg-[#9e3e26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1eadc] disabled:opacity-50"
              disabled={uploadDisabled}
              onClick={() => {
                if (uploadDisabled) return;
                // Close the native modal before clicking the existing input, synchronously
                // in this user activation. Do not await/effect the Safari file picker.
                close();
                onUpload();
              }}
              type="button"
            >↑ Ladda upp egna bilder</button>
            {photo ? <a className="flex min-h-11 items-center justify-center rounded-sm px-2 text-sm text-[#e6dcc7] underline decoration-[#e6dcc7]/45 underline-offset-4 active:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1eadc]" href={photo.photoUrl} rel="noopener noreferrer" target="_blank">Öppna original <span className="sr-only">(ny flik)</span></a> : null}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
