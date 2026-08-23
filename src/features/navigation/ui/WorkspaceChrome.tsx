import Link from "next/link";
import type { ReactNode } from "react";
import { canAccessView, hasAnyRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import {
  getProductWorkspace,
  productWorkspaces,
  type ProductWorkspaceKey,
} from "../model/workspaces";
import { logoutAction } from "../server/actions";
import styles from "./workspace-chrome.module.css";

export function WorkspaceChrome({
  activeWorkspace,
  children,
  contextLabel,
  session,
}: {
  activeWorkspace: ProductWorkspaceKey;
  children: ReactNode;
  contextLabel?: string;
  session: AppSession;
}) {
  const current = getProductWorkspace(activeWorkspace);
  const visibleWorkspaces = productWorkspaces.filter(
    (workspace) =>
      canAccessView(session, workspace.permissionView) &&
      (!workspace.allowedRoles || hasAnyRole(session, workspace.allowedRoles)),
  );
  const daily = visibleWorkspaces.filter((workspace) => workspace.group === "daily");
  const system = visibleWorkspaces.filter((workspace) => workspace.group === "system");

  return (
    <div className={styles.shell}>
      <header className={styles.chrome}>
        <Link className={styles.brand} href="/today">
          Dental OS
        </Link>

        <details className={styles.workspaceSwitcher}>
          <summary>
            <span>{contextLabel ?? current.label}</span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className={styles.workspaceMenu}>
            <nav aria-label="Không gian làm việc">
              {daily.map((workspace) => (
                <Link
                  aria-current={workspace.key === activeWorkspace && !contextLabel ? "page" : undefined}
                  className={workspace.key === activeWorkspace && !contextLabel ? styles.activeLink : undefined}
                  href={workspace.href}
                  key={workspace.key}
                >
                  {workspace.label}
                </Link>
              ))}
              {system.length > 0 && <div className={styles.menuDivider} />}
              {system.map((workspace) => (
                <Link
                  aria-current={workspace.key === activeWorkspace && !contextLabel ? "page" : undefined}
                  className={workspace.key === activeWorkspace && !contextLabel ? styles.activeLink : undefined}
                  href={workspace.href}
                  key={workspace.key}
                >
                  {workspace.label}
                </Link>
              ))}
            </nav>
          </div>
        </details>

        <div className={styles.chromeSpacer} />

        {canAccessView(session, "patients") && (
          <Link className={styles.quickFind} href="/patients">
            Tìm bệnh nhân
          </Link>
        )}

        <details className={styles.accountMenu}>
          <summary>{session.fullName}</summary>
          <div className={styles.accountPopover}>
            <strong>{session.fullName}</strong>
            <span>{session.organizationName}</span>
            <span>{session.email}</span>
            <div className={styles.menuDivider} />
            {canAccessView(session, "employee-app") && (
              <Link href="/employee-app">Hồ sơ của tôi</Link>
            )}
            <form action={logoutAction}>
              <button type="submit">Đăng xuất</button>
            </form>
          </div>
        </details>
      </header>

      <main className={styles.canvas}>{children}</main>
    </div>
  );
}
