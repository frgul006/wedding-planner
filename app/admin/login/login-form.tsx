"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

type LoginFormProps = {
  nextPath: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={nextPath} />

      <label className="flex flex-col gap-2 text-sm font-medium text-zinc-800">
        Email
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-950"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-zinc-800">
        Password
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-950"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        className="rounded-full bg-zinc-950 px-5 py-3 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={pending}
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
