import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Admin login | Wedding Planner",
};

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 py-12">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <div className="mb-8 space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Wedding Planner
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            Admin login
          </h1>
          <p className="text-zinc-600">
            Sign in with your Supabase admin account to manage the wedding.
          </p>
        </div>

        <LoginForm nextPath={next?.startsWith("/admin") ? next : "/admin"} />
      </section>
    </main>
  );
}
