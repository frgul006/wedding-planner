import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { getSafeHttpUrl } from "@/lib/safe-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isNullableString, isRecord, isStringArray } from "@/lib/type-guards";

export const metadata: Metadata = {
  title: "Wedding hub | Wedding Planner",
};

type HubWedding = {
  allow_anonymous_hub_upload: boolean;
  name: string;
  spotify_playlist_url: string | null;
  time_plan: string[];
  venue_name: string | null;
  wedding_date: string | null;
};

const textureStyle: CSSProperties = {
  backgroundImage:
    "radial-gradient(rgba(21,19,15,0.045) 1px, transparent 1.4px), radial-gradient(rgba(179,74,44,0.045) 1px, transparent 1.6px)",
  backgroundSize: "5px 5px, 11px 11px",
};

const dateBadgeFormatter = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

const weddingDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});
const hubWeddingSelect =
  "allow_anonymous_hub_upload, name, spotify_playlist_url, time_plan, venue_name, wedding_date";

function normalizeWedding(value: unknown): HubWedding | null {
  if (
    !isRecord(value) ||
    typeof value.allow_anonymous_hub_upload !== "boolean" ||
    typeof value.name !== "string" ||
    !isNullableString(value.spotify_playlist_url) ||
    !isNullableString(value.venue_name) ||
    !isNullableString(value.wedding_date)
  ) {
    return null;
  }

  return {
    allow_anonymous_hub_upload: value.allow_anonymous_hub_upload,
    name: value.name,
    spotify_playlist_url: value.spotify_playlist_url,
    time_plan: isStringArray(value.time_plan) ? value.time_plan : [],
    venue_name: value.venue_name,
    wedding_date: value.wedding_date,
  };
}

function formatDateBadge(value: string | null) {
  if (!value) {
    return "Bröllopshub";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Bröllopshub";
  }

  return dateBadgeFormatter.format(date).replace(".", "").toLocaleUpperCase("sv-SE");
}

function formatWeddingDate(value: string | null) {
  if (!value) {
    return "Datum kommer";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Datum kommer";
  }

  return weddingDateFormatter.format(date);
}

function getMonogram(name: string) {
  const cleanedName = name.replace(/<3|&|\+|och|and/gi, " ");
  const parts = cleanedName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0]?.charAt(0).toUpperCase() ?? "W";
  const second = parts.length > 1 ? parts[parts.length - 1]?.charAt(0).toUpperCase() : "H";

  return `${first}&${second}`;
}

function getConfiguredWeddingId() {
  return process.env.WEDDING_ID ?? process.env.NEXT_PUBLIC_WEDDING_ID ?? null;
}

async function getHubWedding() {
  const supabase = createSupabaseAdminClient();
  const configuredWeddingId = getConfiguredWeddingId();

  if (configuredWeddingId) {
    const { data, error } = await supabase
      .from("weddings")
      .select(hubWeddingSelect)
      .eq("id", configuredWeddingId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load configured wedding hub settings", error);
      return null;
    }

    return normalizeWedding(data);
  }

  const { data, error } = await supabase
    .from("weddings")
    .select(hubWeddingSelect)
    .order("created_at", { ascending: true })
    .limit(2);

  if (error) {
    console.error("Failed to load wedding hub settings", error);
    return null;
  }

  if (!data || data.length !== 1) {
    if (data && data.length > 1) {
      console.error(
        "Multiple weddings found for public hub. Set WEDDING_ID to choose the shared QR wedding.",
      );
    }

    return null;
  }

  return normalizeWedding(data[0]);
}

function SpotifyAction({ spotifyUrl }: { spotifyUrl: string | null }) {
  if (!spotifyUrl) {
    return (
      <button
        aria-describedby="spotify-missing"
        className="flex min-h-34 cursor-not-allowed flex-col items-center justify-center gap-3 border border-[#15130f] bg-[#f1eadc] px-4 py-6 text-center text-[#15130f] opacity-65"
        disabled
        type="button"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current text-2xl">
          ♪
        </span>
        <span className="font-serif text-3xl italic leading-none">Spellistan</span>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.28em]">
          Saknas
        </span>
      </button>
    );
  }

  return (
    <a
      className="flex min-h-34 flex-col items-center justify-center gap-3 border border-[#15130f] bg-[#f1eadc] px-4 py-6 text-center text-[#15130f] no-underline transition hover:bg-[#6f4f33] hover:text-[#f1eadc]"
      href={spotifyUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current text-2xl">
        ♪
      </span>
      <span className="font-serif text-3xl italic leading-none">Spellistan</span>
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.28em]">
        Öppna Spotify
      </span>
    </a>
  );
}

export default async function WeddingHubPage() {
  await connection();

  const wedding = await getHubWedding();
  const spotifyUrl = getSafeHttpUrl(wedding?.spotify_playlist_url ?? null);
  const weddingName = wedding?.name ?? "Wedding hub";
  const photoNote = wedding?.allow_anonymous_hub_upload === false
    ? "Bilduppladdning kommer i nästa byggsteg. När anonym uppladdning är avstängd kommer gäster behöva en giltig personlig inbjudningssession."
    : "Bilduppladdning kommer i nästa byggsteg. När den öppnar kan gäster ladda upp från QR-hubben utan inloggning.";

  return (
    <main
      className="min-h-dvh bg-[#f1eadc] pb-28 text-[#15130f]"
      style={textureStyle}
    >
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col shadow-[0_0_0_1px_rgba(21,19,15,0.08)]">
        <header className="flex items-center justify-between border-b border-[#15130f]/15 px-5 py-4">
          <p className="font-serif text-2xl italic tracking-tight text-[#6f4f33]">
            {getMonogram(weddingName)}
          </p>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-[#6b6358]">
            Bröllopshub · {formatDateBadge(wedding?.wedding_date ?? null)}
          </p>
        </header>

        <section className="px-6 pb-4 pt-8 text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.4em] text-[#6f4f33]">
            {weddingName}
          </p>
          <h1 className="mt-4 font-serif text-5xl leading-[0.95] tracking-tight">
            Lägg till en <span className="italic text-[#b34a2c]">låt</span>
            <br />
            eller en <span className="italic text-[#b34a2c]">bild</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#6b6358]">
            Allt samlas i bröllopshubben: spellistan nu och fotoflödet när
            uppladdningen öppnar.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 px-5 py-3" aria-label="Hub actions">
          <button
            aria-describedby="photo-coming-next"
            className="flex min-h-34 cursor-not-allowed flex-col items-center justify-center gap-3 border border-[#15130f] bg-[#15130f] px-4 py-6 text-center text-[#f1eadc] opacity-95"
            disabled
            type="button"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current text-2xl">
              ↑
            </span>
            <span className="font-serif text-3xl italic leading-none">Bilder</span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.28em]">
              Kommer snart
            </span>
          </button>
          <SpotifyAction spotifyUrl={spotifyUrl} />
        </section>

        <p
          className="mx-5 my-2 border-l-2 border-[#b34a2c] bg-[#b34a2c]/5 px-3 py-2 font-serif text-sm italic text-[#b34a2c]"
          id="photo-coming-next"
        >
          {photoNote}
          {spotifyUrl ? " Spellistan öppnar Spotify i en ny flik." : " Lägg in Spotify-länken i wedding settings för att aktivera spellistan."}
        </p>
        {!spotifyUrl ? <span className="sr-only" id="spotify-missing">Spotify-länk saknas.</span> : null}

        <section className="mt-3 grid grid-cols-2 border-y border-[#15130f]/15 px-5 py-4">
          <div className="text-center">
            <p className="font-serif text-3xl leading-none">0</p>
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.32em] text-[#6b6358]">
              Bilder
            </p>
          </div>
          <div className="border-l border-[#15130f]/15 text-center">
            <p className="font-serif text-3xl leading-none">Spotify</p>
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.32em] text-[#6b6358]">
              Låtar
            </p>
          </div>
        </section>

        <nav className="grid grid-cols-2 border-b border-[#15130f]/15 px-5" aria-label="Hub views">
          <span className="border-b-2 border-[#b34a2c] py-4 text-center font-mono text-[0.7rem] font-semibold uppercase tracking-[0.28em]">
            Flöde
          </span>
          <span className="py-4 text-center font-mono text-[0.7rem] uppercase tracking-[0.28em] text-[#6b6358]">
            Galleriet
          </span>
        </nav>

        <section className="flex flex-1 flex-col px-5 py-6">
          <div className="grid grid-cols-[2.75rem_1fr] gap-3 border-b border-dashed border-[#15130f]/20 pb-5">
            <div className="flex h-11 w-11 items-center justify-center border border-[#15130f]/20 bg-[#e6dcc7] font-serif text-xl italic text-[#6f4f33]">
              ◇
            </div>
            <div>
              <p className="text-sm font-medium">Inga bidrag än</p>
              <p className="mt-1 text-sm leading-6 text-[#6b6358]">
                Fotoflödet och galleriet aktiveras i nästa steg. Tills dess kan
                gästerna använda spellistan från samma QR-kod.
              </p>
              <span className="mt-2 block font-mono text-[0.65rem] uppercase tracking-[0.22em] text-[#6b6358]">
                {formatWeddingDate(wedding?.wedding_date ?? null)}
                {wedding?.venue_name ? ` · ${wedding.venue_name}` : ""}
              </span>
            </div>
          </div>

          {wedding?.time_plan.length ? (
            <div className="mt-6 rounded-none border border-[#15130f]/15 bg-[#f1eadc]/70 p-4">
              <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.32em]">
                Dagens plan
              </h2>
              <ol className="mt-3 grid gap-2 text-sm text-[#6b6358]">
                {wedding.time_plan.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t-2 border-[#b34a2c] bg-[#15130f]/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
          <button
            className="cursor-not-allowed bg-[#b34a2c] px-3 py-4 text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.28em] text-[#f1eadc] opacity-70"
            disabled
            type="button"
          >
            ↑ Ladda upp
          </button>
          {spotifyUrl ? (
            <a
              className="border border-white/25 px-3 py-4 text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.28em] text-[#f1eadc] no-underline"
              href={spotifyUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              ♪ Lägg till låt
            </a>
          ) : (
            <button
              className="cursor-not-allowed border border-white/25 px-3 py-4 text-center font-mono text-[0.75rem] font-semibold uppercase tracking-[0.28em] text-[#f1eadc] opacity-60"
              disabled
              type="button"
            >
              ♪ Saknas
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
