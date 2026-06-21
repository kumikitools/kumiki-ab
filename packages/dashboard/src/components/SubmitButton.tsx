"use client";

import { useFormStatus } from "react-dom";

/** A submit button that disables + relabels itself while its form is pending. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel ?? "Working…" : children}
    </button>
  );
}
