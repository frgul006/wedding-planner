import Link from "next/link";
import type { Metadata } from "next";
import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  buildCateringSummary,
  loadGuestExportData,
} from "@/lib/admin-guest-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Cateringunderlag | Wedding Planner",
};
export const dynamic = "force-dynamic";

export default async function CateringPage() {
  const admin = await requireActiveAdminProfile();
  let summary: ReturnType<typeof buildCateringSummary>;
  try {
    summary = buildCateringSummary(
      await loadGuestExportData(
        await createSupabaseServerClient(),
        admin.wedding_id,
      ),
    );
  } catch {
    return (
      <main>
        <h1 className="font-serif text-3xl">Cateringunderlag</h1>
        <p role="alert">Kunde inte hämta hela underlaget. Ladda om sidan.</p>
        <Link href="/admin/guests">Tillbaka till gästlistan</Link>
      </main>
    );
  }
  return (
    <main className="grid gap-5">
      <header>
        <Link className="text-sm underline" href="/admin/guests">
          ← Gästlista
        </Link>
        <h1 className="mt-3 font-serif text-4xl">Cateringunderlag</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#6f604d]">
          Endast sparade ja-svar, inklusive +1. Nej, kanske och obesvarade ingår
          inte. Inga kontaktuppgifter eller privata admin-noteringar delas.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <a
          className="bulk-button bg-[#eadcc3]"
          href="/admin/guests/export?kind=catering&format=txt"
        >
          Ladda ner sammanfattning (.txt)
        </a>
        <a
          className="bulk-button"
          href="/admin/guests/export?kind=catering&format=csv"
        >
          Ladda ner personlista (.csv)
        </a>
      </div>
      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Antal till catering"
      >
        {[
          ["Personer som kommer", summary.people.length],
          ["Med mat-/allergiuppgifter", summary.withDietary],
          ["Utan mat-/allergiuppgifter", summary.withoutDietary],
        ].map(([label, count]) => (
          <div
            key={label}
            className="rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] p-4"
          >
            <p className="text-sm">{label}</p>
            <p className="mt-2 font-serif text-3xl">{count}</p>
          </div>
        ))}
      </section>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Kontrollera innan beställning.</strong> Ej angivet betyder inte
        allergifri. Gästernas fritext återges utan tolkning. Samma person kan
        finnas i både mat- och allergisammanställningen; summera inte grupperna
        till ett personantal.
      </p>
      {summary.warnings.length ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <h2 className="font-bold">Uppgifter att stämma av</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {summary.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { title: "Matpreferenser", groups: summary.food },
          { title: "Allergier", groups: summary.allergies },
        ].map(({ title, groups }) => (
          <section
            key={title}
            className="rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] p-5"
          >
            <h2 className="font-serif text-2xl">{title}</h2>
            <p className="mt-1 text-xs text-[#6f604d]">
              Antal personer per fritextuppgift. Endast blanksteg runt texten
              och versaler normaliseras.
            </p>
            <ul className="mt-3 grid gap-2">
              {groups.map((group) => (
                <li
                  className="flex items-start justify-between gap-4 border-t border-[#eadcc3] pt-2"
                  key={group.text}
                >
                  <span className="whitespace-pre-wrap break-words">
                    {group.text}
                  </span>
                  <strong>{group.count}</strong>
                </li>
              ))}
            </ul>
            {!groups.length ? (
              <p className="mt-3 text-sm">Inga uppgifter.</p>
            ) : null}
          </section>
        ))}
      </div>
      <section className="rounded-2xl border border-[#d8c7a3] bg-[#fffaf1] p-5">
        <h2 className="font-serif text-2xl">Personlista</h2>
        <div className="mt-4 grid gap-3">
          {summary.people.map((person, index) => (
            <div
              key={`${person.name}-${index}`}
              className="grid gap-2 border-t border-[#eadcc3] py-3 md:grid-cols-3"
            >
              <div className="break-words">
                <strong>{person.name}</strong>
                {person.invitedBy ? (
                  <p className="text-xs text-[#6f604d]">
                    +1 till {person.invitedBy}
                  </p>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">
                <strong>Mat: </strong>
                {person.food || "Ej angivet"}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                <strong>Allergier: </strong>
                {person.allergy || "Ej angivet"}
              </p>
            </div>
          ))}
          {!summary.people.length ? (
            <p>Inga gäster har tackat ja ännu.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
