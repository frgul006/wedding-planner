import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export { createSupabaseAdminClient } from "@/lib/supabase/admin";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function getSupabasePublicEnv() {
  return {
    supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export async function createSupabaseServerClient() {
  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. Middleware/proxy and Server
          // Actions handle session refresh/write paths.
        }
      },
    },
  });
}
