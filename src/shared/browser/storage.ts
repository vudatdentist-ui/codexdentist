type StorageKind = "local" | "session";

function storage(kind: StorageKind): Storage {
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

// Preferences and scroll restoration are best-effort enhancements. Accessing
// the Storage property itself can throw, before getItem/setItem is invoked.
export function readBrowserStorage(kind: StorageKind, key: string): string | null {
  try { return storage(kind).getItem(key); } catch { return null; }
}

export function writeBrowserStorage(kind: StorageKind, key: string, value: string): boolean {
  try { storage(kind).setItem(key, value); return true; } catch { return false; }
}

export function removeBrowserStorage(kind: StorageKind, key: string): boolean {
  try { storage(kind).removeItem(key); return true; } catch { return false; }
}
