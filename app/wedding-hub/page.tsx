import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { WeddingHubClient } from "@/app/wedding-hub/_components/wedding-hub-client";
import { getSafeHttpUrl } from "@/lib/safe-url";
import { resolveWeddingHubContext } from "@/lib/wedding-hub-photo";
import { getWeddingHubPhotoData } from "@/lib/wedding-hub-photo-verification";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { GUEST_NAVIGATION_COOKIE_NAME } from "@/lib/guest-navigation-session";

export const metadata: Metadata = {
  title: "Wedding hub | Wedding Planner",
};

export default async function WeddingHubPage() {
  await connection();

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(GUEST_NAVIGATION_COOKIE_NAME)?.value ?? null;
  const supabase = createSupabaseAdminClient();
  const context = await resolveWeddingHubContext({
    supabase,
    existingCookieValue: cookieValue,
  });

  if (!context) {
    return (
      <main className="min-h-dvh bg-[#f1eadc] px-4 py-16 text-center text-[#6b6358]">
        <h1 className="font-serif text-3xl italic">Konfiguration saknas</h1>
        <p className="mt-3">Bröllopshubben kunde inte hittas. Kontrollera inställningar.</p>
      </main>
    );
  }

  const photoData = await getWeddingHubPhotoData({
    supabase,
    wedding: context.wedding,
  });

  const spotifyEnabled = Boolean(getSafeHttpUrl(context.wedding.spotify_playlist_url));

  return (
    <WeddingHubClient
      context={context}
      wedding={context.wedding}
      initialPhotoData={photoData}
      spotifyEnabled={spotifyEnabled}
    />
  );
}
