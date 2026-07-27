"use client";

import {
  StagedOdontogram,
  type OdontogramData,
  type OdontogramStagesData,
  type StagedOdontogramChange,
} from "codexdentist-odontogram";
import { useEffect, useState } from "react";
import {
  emptyOdontogramData,
  normalizeOdontogramData,
} from "@/lib/odontogram-data";

const stageStorageKey = "codexdentist-odontogram-stages-v2";
const singleSnapshotStorageKey = "codexdentist-odontogram-data-v1";
const legacyStorageKeys = {
  surfaceState: "codexdentist-odontogram-5-surface-v1",
  anatomyState: "codexdentist-odontogram-anatomy-v1",
  markerState: "codexdentist-odontogram-clinical-markers-v1",
  bridges: "codexdentist-odontogram-bridges-v1",
  quickDiagnosis: "codexdentist-odontogram-quick-diagnosis-v1",
} as const;

export function PublicOdontogram() {
  const [initialStages, setInitialStages] =
    useState<OdontogramStagesData | null>(null);

  useEffect(() => {
    setInitialStages(readStoredStages());
  }, []);

  if (!initialStages) {
    return <div className="public-odontogram-loading">Đang mở odontogram...</div>;
  }

  return (
    <StagedOdontogram
      assetBaseUrl="/api/odontogram-assets"
      defaultStages={initialStages}
      onStagesChange={persistStageChange}
    />
  );
}

function readStoredStages(): OdontogramStagesData {
  try {
    const storedStages = window.localStorage.getItem(stageStorageKey);
    if (storedStages) {
      return normalizeStoredStages(JSON.parse(storedStages));
    }

    const migrated = migrateSingleSnapshot(readSingleSnapshot());
    persistStages(migrated);
    return migrated;
  } catch {
    return migrateSingleSnapshot(emptyOdontogramData);
  }
}

function readSingleSnapshot(): OdontogramData {
  const stored = window.localStorage.getItem(singleSnapshotStorageKey);
  if (stored) {
    return normalizeOdontogramData(JSON.parse(stored));
  }

  return normalizeOdontogramData({
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
}

function normalizeStoredStages(value: unknown): OdontogramStagesData {
  const stages =
    value && typeof value === "object" && "stages" in value
      ? (value as { stages: Partial<OdontogramStagesData> }).stages
      : (value as Partial<OdontogramStagesData>);
  const initial = stages?.INITIAL
    ? normalizeOdontogramData(stages.INITIAL)
    : emptyOdontogramData;

  return {
    INITIAL: initial,
    EXPECTED: stages?.EXPECTED
      ? normalizeOdontogramData(stages.EXPECTED)
      : null,
    CURRENT: stages?.CURRENT
      ? normalizeOdontogramData(stages.CURRENT)
      : initial,
  };
}

function migrateSingleSnapshot(
  snapshot: OdontogramData,
): OdontogramStagesData {
  return {
    INITIAL: snapshot,
    EXPECTED: null,
    CURRENT: snapshot,
  };
}

function parseLegacyValue<T>(key: string, fallback: T): T {
  const value = window.localStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

function persistStageChange(change: StagedOdontogramChange) {
  persistStages(change.stages);
}

function persistStages(stages: OdontogramStagesData) {
  try {
    window.localStorage.setItem(
      stageStorageKey,
      JSON.stringify({ version: 2, stages }),
    );
  } catch {
    // The public chart remains usable when browser storage is unavailable.
  }
}
