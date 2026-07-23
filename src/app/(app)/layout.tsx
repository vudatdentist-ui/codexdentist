import type { ReactNode } from "react";
import { DemoWorkspaceBanner } from "@/components/DemoWorkspaceBanner";
import { requireSession } from "@/lib/auth";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();

  return (
    <>
      {session.isDemo && session.workspaceExpiresAt && (
        <DemoWorkspaceBanner expiresAt={session.workspaceExpiresAt} />
      )}
      {children}
    </>
  );
}
