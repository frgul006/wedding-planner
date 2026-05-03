import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        error: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    userCountOnFirstPage: data.users.length,
  });
}
