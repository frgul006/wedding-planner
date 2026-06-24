import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { getRequestOriginFromHeaders } from "@/lib/public-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatWeddingSettingsDate } from "@/lib/wedding-settings-display";
import { getWeddingHubUrl } from "@/lib/wedding-hub-url";

import { QrCodeActions } from "./qr-code-actions";

export const metadata: Metadata = {
  title: "Bröllopshubben QR | Wedding Planner",
};

type WeddingQrDetails = {
  name: string;
  venue_name: string | null;
  wedding_date: string | null;
};

function getWeddingDetails(value: unknown): WeddingQrDetails | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const wedding = value as Partial<WeddingQrDetails>;

  if (typeof wedding.name !== "string") {
    return null;
  }

  return {
    name: wedding.name,
    venue_name: typeof wedding.venue_name === "string" ? wedding.venue_name : null,
    wedding_date: typeof wedding.wedding_date === "string" ? wedding.wedding_date : null,
  };
}

export default async function QrCodePage() {
  await connection();

  const [adminProfile, headersList] = await Promise.all([
    requireActiveAdminProfile(),
    headers(),
  ]);
  const hubUrl = getWeddingHubUrl({
    requestOrigin: getRequestOriginFromHeaders(headersList),
  });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("weddings")
    .select("name, wedding_date, venue_name")
    .eq("id", adminProfile.wedding_id)
    .maybeSingle();
  const wedding = getWeddingDetails(data);

  return (
    <main className="min-h-dvh bg-zinc-50 px-6 py-10 print:bg-white print:px-0 print:py-0">
      <section className="mx-auto flex max-w-5xl flex-col gap-8 print:max-w-none print:gap-0">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Wedding Planner
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
              Bröllopshubben QR
            </h1>
            <p className="mt-2 text-zinc-600">
              Ladda ner eller skriv ut QR-koden som Gäster skannar på plats.
            </p>
          </div>
          <Link
            className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
            href="/admin"
          >
            Tillbaka till översikten
          </Link>
        </div>

        {error ? (
          <p className="rounded-2xl bg-red-50 px-5 py-4 text-sm font-medium text-red-700 ring-1 ring-red-100 print:hidden">
            Kunde inte ladda bröllopsdetaljer. QR-koden pekar fortfarande till bröllopshubben.
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] print:block">
          <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 print:rounded-none print:p-12 print:text-center print:shadow-none print:ring-0">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
              QR på plats
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-zinc-950 print:text-4xl">
              Skanna till bröllopshubben
            </h2>
            <div className="mt-6 rounded-3xl bg-[#f1eadc] p-5 ring-1 ring-zinc-200 print:mx-auto print:max-w-sm print:ring-0">
              <Image
                alt="QR-kod till bröllopshubben"
                className="aspect-square w-full rounded-2xl bg-[#f1eadc]"
                height={1200}
                priority
                src="/admin/qr-code/png"
                unoptimized
                width={1200}
              />
            </div>
            <p className="mt-5 break-all text-sm text-zinc-600 print:text-base print:text-zinc-900">
              {hubUrl}
            </p>
            <p className="mt-3 text-sm text-zinc-500 print:text-zinc-700">
              {wedding?.name ?? "Bröllopshubben"}
              {wedding?.venue_name ? ` · ${wedding.venue_name}` : ""}
              {wedding?.wedding_date
                ? ` · ${formatWeddingSettingsDate(wedding.wedding_date, {
                    fallback: "Bröllopsdatum saknas",
                  })}`
                : ""}
            </p>
          </section>

          <section className="flex flex-col gap-6 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 print:hidden">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Dela och skriv ut</h2>
              <p className="mt-2 text-zinc-600">
                The QR-koden öppnar den delade bröllopshubben. Den delas av alla Gäster och
                visar inga privata inbjudningslänkar eller Gästdetaljer.
              </p>
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
              Hubb-URL
              <input
                className="rounded-2xl border border-zinc-300 bg-zinc-50 px-4 py-3 font-mono text-sm text-zinc-950"
                readOnly
                value={hubUrl}
              />
            </label>

            <QrCodeActions hubUrl={hubUrl} />

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                className="rounded-full bg-zinc-950 px-5 py-3 text-center font-medium text-white transition hover:bg-zinc-800"
                download="wedding-hub-qr.png"
                href="/admin/qr-code/png?download=1"
              >
                Ladda ner PNG
              </a>
              <a
                className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100"
                href={hubUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Öppna bröllopshubben
              </a>
            </div>

            <div className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-600">
              <h3 className="font-semibold text-zinc-950">Utskriftstips</h3>
              <p className="mt-2">
                Use the print button and choose A4 or Letter. The printed sheet keeps the
                QR code large with the readable fallback URL underneath.
              </p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
