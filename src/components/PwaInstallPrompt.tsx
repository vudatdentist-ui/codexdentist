"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, RefreshCw, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const pwaRoutes = new Set(["/employee-app", "/patient-app"]);

function isStandaloneDisplay() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function clearDevelopmentServiceWorker() {
  if (process.env.NODE_ENV === "production" || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch(() => null);

  if ("caches" in window) {
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("nhavista-pwa-") || key.startsWith("codexmed-pwa-"))
            .map((key) => caches.delete(key)),
        ),
      )
      .catch(() => null);
  }
}

export function PwaInstallPrompt() {
  const pathname = usePathname();
  const isMobileAppRoute = useMemo(() => pwaRoutes.has(pathname), [pathname]);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    setIsStandalone(isStandaloneDisplay());
    clearDevelopmentServiceWorker();

    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    let waitingWorker: ServiceWorker | null = null;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        waitingWorker = registration.waiting;
        setUpdateReady(Boolean(waitingWorker));

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;

          if (!worker) {
            return;
          }

          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              waitingWorker = worker;
              setUpdateReady(true);
            }
          });
        });
      })
      .catch(() => {
        // PWA support should never block the operational web app.
      });

    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      waitingWorker = null;
    };
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!isMobileAppRoute || dismissed || isStandalone) {
    return null;
  }

  return (
    <div className="pwa-install-banner" role="status">
      <div>
        <strong>Codexdentist mobile</strong>
        <span>Cài lên màn hình chính để dùng nhanh như app.</span>
      </div>
      {installEvent ? (
        <button
          type="button"
          onClick={async () => {
            const event = installEvent;
            setInstallEvent(null);
            await event.prompt();
            await event.userChoice.catch(() => null);
          }}
        >
          <Download size={15} />
          Cài app
        </button>
      ) : updateReady ? (
        <button
          type="button"
          onClick={() =>
            navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" })
          }
        >
          <RefreshCw size={15} />
          Cập nhật
        </button>
      ) : (
        <span className="pwa-install-hint">Mở menu trình duyệt để Add to Home Screen</span>
      )}
      <button
        className="pwa-install-close"
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Đóng"
      >
        <X size={15} />
      </button>
    </div>
  );
}
