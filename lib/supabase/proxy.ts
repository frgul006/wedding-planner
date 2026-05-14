import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type AdminProfile = {
  id: string;
  wedding_id: string;
  is_active: boolean;
};

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!supabasePublishableKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let adminProfile: AdminProfile | null = null;

  if (user) {
    const { data } = await supabase
      .from("admin_profiles")
      .select("id, wedding_id, is_active")
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    adminProfile = data;
  }

  return { response, user, adminProfile };
}
