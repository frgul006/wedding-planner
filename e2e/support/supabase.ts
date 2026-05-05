import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "./env";

export function createE2eSupabaseAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
