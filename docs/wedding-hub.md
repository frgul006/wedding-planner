# Wedding hub photo browsing

The header rings are round and still. The main actions are illustrated characters: a large retro camera that slowly sways and blinks its lens, and a singing musical note with three smaller notes that drift upward and fade. Each sits on a cream card with a border, raised shadow, and rust-colored action label, plus hover, press, and keyboard-focus feedback. The entire card is clickable; the artwork moves inside steady click targets, with the Swedish labels fixed underneath. Motion runs while the main actions are visible and no upload is running. Reduced-motion preferences keep the characters still and hide the floating notes; disabled actions stay still too. A small heart celebrates the first confirmed upload in each batch beside the existing receipt.

`/wedding-hub` shares one full-screen, in-page photo viewer between **Flöde** and **Galleriet**. Tap a thumbnail to open it; use **Föregående bild**, **Nästa bild**, keyboard arrows, or a horizontal swipe over the image. Images fit without cropping. The viewer shows the contributor, optional scrollable caption, and position in the loaded collection (up to 60 photos, not the total upload count). Navigation stops at either end. While the selected original loads, **Laddar bild…** and any available separate thumbnail give feedback; navigation and upload stay usable. Only the selected full-size image loads.

**Stäng** or Escape returns focus and scroll position to browsing. Background refresh keeps the selected photo ID, even when newer photos arrive. If it disappears from the public collection, the viewer reports that it is unavailable rather than showing a different photo.

**Ladda upp egna bilder** closes the viewer and opens the existing picker in the same click. Selecting files reveals **Valda filer** for optional notes and explicit upload; cancelling leaves the hub usable. The existing sticky upload action remains available while scrolling, with only one bottom action area visible. Access and in-flight upload gates still apply.

**Öppna original (ny flik)** remains an explicit alternative, including when an original cannot load or the browser cannot decode HEIC/HEIF. No conversion, upload verification, moderation, attribution, or Spotify behavior changes.

Browser regressions: `e2e/wedding-hub-photo-viewer.spec.ts`, plus existing upload/QR tests. Mobile viewport and synthetic touch checks do not replace physical iPhone Safari/camera-roll testing. Upload details: [public upload PRD](prd/photo-upload-public.md), [admin photos](admin-photos.md).
