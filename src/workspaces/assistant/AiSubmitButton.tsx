"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function AiSubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className="primary-button compact-button" type="submit" disabled={pending} aria-busy={pending}>
    {pending ? pendingLabel : children}
  </button>;
}
