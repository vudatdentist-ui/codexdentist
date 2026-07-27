"use client";

import {
  Odontogram,
  type OdontogramData,
} from "codexdentist-odontogram";
import { useEffect, useState } from "react";
import {
  emptyOdontogramData,
  normalizeOdontogramData,
} from "@/lib/odontogram-data";

const storageKey = "codexdentist-odontogram-data-v1";
const legacyStorageKeys = {
  surfaceState: "codexdentist-odontogram-5-surface-v1",
  anatomyState: "codexdentist-odontogram-anatomy-v1",
  markerState: "codexdentist-odontogram-clinical-markers-v1",
  bridges: "codexdentist-odontogram-bridges-v1",
  quickDiagnosis: "codexdentist-odontogram-quick-diagnosis-v1",
} as const;

export function PublicOdontogram() {
  const [initialData, setInitialData] = useState<OdontogramData | null>(null);

  useEffect(() => {
    setInitialData(readStoredData());
  }, []);

  if (!initialData) {
    return <div className="public-odontogram-loading">Đang mở odontogram...</div>;
  }

  return (
    <Odontogram
      assetBaseUrl="/api/odontogram-assets"
      defaultValue={initialData}
      onChange={persistData}
    />
  );
}

function readStoredData(): OdontogramData {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      return normalizeOdontogramData(JSON.parse(stored));
    }

    const migrated = normalizeOdontogramData({
      version: 1,
      surfaceState: parseLegacyValue(legacyStorageKeys.surfaceState, {}),
      anatomyState: parseLegacyValue(legacyStorageKeys.anatomyState, {}),
      markerState: parseLegacyValue(legacyStorageKeys.markerState, {}),
      bridges: parseLegacyValue(legacyStorageKeys.bridges, []),
      quickDiagnosis: parseLegacyValue(
        legacyStorageKeys.quickDiagnosis,
        emptyOdontogramData.quickDiagnosis,
      ),
    });
    persistData(migrated);
    return migrated;
  } catch {
    return emptyOdontogramData;
  }
}

function parseLegacyValue<T>(key: string, fallback: T): T {
  const value = window.localStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

function persistData(data: OdontogramData) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // The public chart remains usable when browser storage is unavailable.
  }
}
