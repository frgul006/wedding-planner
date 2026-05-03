import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActiveAdminProfile = {
  id: string;
  wedding_id: string;
  email: string;
  display_name: string | null;
  role: string;
};

export async function requireActiveAdminProfile(): Promise<ActiveAdminProfile> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("id, wedding_id, email, display_name, role")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!adminProfile) {
    redirect("/admin/unauthorized");
  }

  return adminProfile;
}
