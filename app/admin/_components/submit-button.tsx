"use client";

import { useFormStatus } from "react-dom";

export function AdminSubmitButton({
  children,
  className = "",
  disabled = false,
  pendingLabel = "Arbetar…",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
