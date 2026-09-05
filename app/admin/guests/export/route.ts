import { requireActiveAdminProfile } from "@/lib/admin-auth";
import {
  buildCateringSummary,
  cateringText,
  csvDocument,
  loadGuestExportData,
  rawGuestCsv,
  rawGuestExport,
} from "@/lib/admin-guest-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireActiveAdminProfile();
  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "csv";
  const catering = params.get("kind") === "catering";
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!(catering ? ["csv", "txt"] : ["csv", "json"]).includes(format)) {
    return new Response("Ogiltigt exportformat.", { status: 400, headers });
  }
  try {
    const data = await loadGuestExportData(
      await createSupabaseServerClient(),
      admin.wedding_id,
    );
    let body: string;
    if (catering) {
      const summary = buildCateringSummary(data);
      body =
        format === "txt"
          ? cateringText(summary)
          : csvDocument(
              ["Namn", "+1 till", "Matpreferens", "Allergier", "Kontrollera"],
              [
                ...summary.people.map((person) => [
                  person.name,
                  person.invitedBy,
                  person.food?.trim() ? person.food : "Ej angivet",
                  person.allergy?.trim() ? person.allergy : "Ej angivet",
                  "",
                ]),
                ...summary.warnings.map((warning) => ["", "", "", "", warning]),
              ],
            );
    } else {
      body =
        format === "json"
          ? JSON.stringify(
              {
                exported_at: data.exportedAt,
                guests: rawGuestExport(data),
              },
              null,
              2,
            )
          : rawGuestCsv(data);
    }
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": `${format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/plain"}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${catering ? "catering" : "guestlist"}-${new Date().toISOString().slice(0, 10)}.${format}"`,
      },
    });
  } catch (error) {
    console.error("Failed to export guest list", error);
    return new Response(
      "Kunde inte hämta hela underlaget. Försök igen; ingen ofullständig export skapades.",
      { status: 500, headers },
    );
  }
}
