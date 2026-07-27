"use client";

import {
  Odontogram,
  type OdontogramData,
} from "codexdentist-odontogram";
import { ChevronRight, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { savePatientOdontogramAction } from "@/app/(app)/journey/odontogram-actions";
import type { Language } from "@/components/AppLanguage";
import {
  odontogramStages,
  type PatientOdontogramStage,
  type PatientOdontogramStageSummary,
  type PatientOdontogramSummary,
} from "@/lib/journey-records-types";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
type StageRecords = Record<
  PatientOdontogramStage,
  PatientOdontogramStageSummary | null
>;
type StageSaveStates = Record<PatientOdontogramStage, SaveState>;

const stageLabels: Record<
  Language,
  Record<PatientOdontogramStage, string>
> = {
  vi: {
    INITIAL: "Hiện trạng ban đầu",
    EXPECTED: "Kết quả kỳ vọng",
    CURRENT: "Tiến độ hiện tại",
  },
  en: {
    INITIAL: "Initial condition",
    EXPECTED: "Expected result",
    CURRENT: "Current progress",
  },
};

const stageDescriptions: Record<
  Language,
  Record<PatientOdontogramStage, string>
> = {
  vi: {
    INITIAL: "Tình trạng được ghi nhận trước khi bắt đầu kế hoạch điều trị.",
    EXPECTED: "Tình trạng mong muốn sau khi hoàn thành kế hoạch điều trị.",
    CURRENT: "Tình trạng thực tế được cập nhật trong quá trình điều trị.",
  },
  en: {
    INITIAL: "The condition recorded before the treatment plan starts.",
    EXPECTED: "The desired condition after the treatment plan is completed.",
    CURRENT: "The actual condition recorded during treatment.",
  },
};

const saveLabels: Record<Language, Record<SaveState, string>> = {
  vi: {
    idle: "Chưa tạo mốc này",
    pending: "Đang chờ lưu",
    saving: "Đang lưu",
    saved: "Đã lưu",
    error: "Chưa lưu được",
  },
  en: {
    idle: "Stage not created",
    pending: "Waiting to save",
    saving: "Saving",
    saved: "Saved",
    error: "Not saved",
  },
};

const copyLabels: Record<
  Language,
  Record<Exclude<PatientOdontogramStage, "INITIAL">, string>
> = {
  vi: {
    EXPECTED: "Sao chép hiện trạng",
    CURRENT: "Sao chép mốc trước",
  },
  en: {
    EXPECTED: "Copy initial condition",
    CURRENT: "Copy previous stage",
  },
};

export function PatientOdontogramEditor({
  canEdit,
  initialOdontogram,
  language,
  onSelectionChange,
  patientId,
  selectedTeeth,
}: {
  canEdit: boolean;
  initialOdontogram: PatientOdontogramSummary | null;
  language: Language;
  onSelectionChange: (teeth: string[]) => void;
  patientId: string;
  selectedTeeth: string[];
}) {
  const [activeStage, setActiveStage] =
    useState<PatientOdontogramStage>("INITIAL");
  const [stageRecords, setStageRecords] = useState<StageRecords>(() =>
    recordsFromSummary(initialOdontogram),
  );
  const [saveStates, setSaveStates] = useState<StageSaveStates>(() =>
    saveStatesFromSummary(initialOdontogram),
  );
  const [saveMessages, setSaveMessages] = useState<
    Record<PatientOdontogramStage, string>
  >({
    INITIAL: "",
    EXPECTED: "",
    CURRENT: "",
  });
  const [chartVersions, setChartVersions] = useState<
    Record<PatientOdontogramStage, number>
  >({
    INITIAL: 0,
    EXPECTED: 0,
    CURRENT: 0,
  });
  const revisionRef = useRef(revisionsFromSummary(initialOdontogram));
  const activeStageRef = useRef<PatientOdontogramStage>("INITIAL");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<{
    stage: PatientOdontogramStage;
    data: OdontogramData;
  } | null>(null);
  const generationRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    generationRef.current += 1;
    activeStageRef.current = "INITIAL";
    revisionRef.current = revisionsFromSummary(initialOdontogram);
    pendingDataRef.current = null;
    setActiveStage("INITIAL");
    setStageRecords(recordsFromSummary(initialOdontogram));
    setSaveStates(saveStatesFromSummary(initialOdontogram));
    setSaveMessages({
      INITIAL: "",
      EXPECTED: "",
      CURRENT: "",
    });
    setChartVersions({
      INITIAL: 0,
      EXPECTED: 0,
      CURRENT: 0,
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [initialOdontogram, patientId]);

  const queueSave = useCallback(
    (stage: PatientOdontogramStage, data: OdontogramData) => {
      const generation = generationRef.current;
      saveChainRef.current = saveChainRef.current
        .then(async () => {
          if (generation !== generationRef.current) {
            return;
          }

          setStageSaveState(setSaveStates, stage, "saving");
          const previousRevision = revisionRef.current[stage];
          const result = await savePatientOdontogramAction({
            patientId,
            stage,
            expectedRevision: previousRevision,
            data,
          });

          if (generation !== generationRef.current) {
            return;
          }

          if (!result.ok) {
            setStageSaveState(setSaveStates, stage, "error");
            setStageMessage(setSaveMessages, stage, result.message);
            return;
          }

          const updatedAt = formatSavedAt(result.updatedAt, languageRef.current);
          revisionRef.current[stage] = result.revision;
          setStageRecords((current) => ({
            ...current,
            [stage]: {
              snapshot: data,
              revision: result.revision,
              updatedAt,
              updatedAtIso: result.updatedAt,
            },
            ...(result.initializedCurrent
              ? {
                  CURRENT: {
                    snapshot: data,
                    revision: 1,
                    updatedAt,
                    updatedAtIso: result.updatedAt,
                  },
                }
              : {}),
          }));
          if (result.initializedCurrent) {
            revisionRef.current.EXPECTED = 0;
            revisionRef.current.CURRENT = 1;
            setStageSaveState(setSaveStates, "CURRENT", "saved");
          }
          setStageSaveState(setSaveStates, stage, "saved");
          setStageMessage(setSaveMessages, stage, "");
        })
        .catch(() => {
          if (generation === generationRef.current) {
            setStageSaveState(setSaveStates, stage, "error");
            setStageMessage(
              setSaveMessages,
              stage,
              languageRef.current === "vi"
                ? "Chưa lưu được odontogram. Vui lòng thử lại."
                : "The odontogram could not be saved. Please try again.",
            );
          }
        });
    },
    [patientId],
  );

  const flushPendingSave = useCallback(() => {
    if (!timerRef.current || !pendingDataRef.current) {
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingDataRef.current;
    pendingDataRef.current = null;
    queueSave(pending.stage, pending.data);
  }, [queueSave]);

  const handleChange = useCallback(
    (data: OdontogramData) => {
      if (!canEdit) {
        return;
      }

      const stage = activeStageRef.current;
      setStageSaveState(setSaveStates, stage, "pending");
      setStageMessage(setSaveMessages, stage, "");
      setStageRecords((current) => ({
        ...current,
        [stage]: {
          snapshot: data,
          revision: revisionRef.current[stage] ?? 0,
          updatedAt: current[stage]?.updatedAt ?? "",
          updatedAtIso: current[stage]?.updatedAtIso ?? "",
        },
      }));
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      pendingDataRef.current = { stage, data };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingDataRef.current = null;
        queueSave(stage, data);
      }, 700);
    },
    [canEdit, queueSave],
  );

  const initialSnapshot = stageRecords.INITIAL?.snapshot;
  const expectedSnapshot =
    stageRecords.EXPECTED?.snapshot ?? initialSnapshot;
  const currentSnapshot =
    stageRecords.CURRENT?.snapshot ?? expectedSnapshot ?? initialSnapshot;
  const snapshots = {
    INITIAL: initialSnapshot,
    EXPECTED: expectedSnapshot,
    CURRENT: currentSnapshot,
  } satisfies Record<PatientOdontogramStage, OdontogramData | undefined>;
  const activeSnapshot = snapshots[activeStage];
  const previousSnapshot =
    activeStage === "EXPECTED"
      ? initialSnapshot
      : activeStage === "CURRENT"
        ? expectedSnapshot
        : undefined;
  const difference = useMemo(
    () => compareSnapshots(previousSnapshot, activeSnapshot),
    [activeSnapshot, previousSnapshot],
  );
  const hasInitialStage = Boolean(stageRecords.INITIAL);
  const activeRecord = stageRecords[activeStage];
  const activeSaveState = saveStates[activeStage];

  const switchStage = (stage: PatientOdontogramStage) => {
    if (stage === activeStage || (stage !== "INITIAL" && !hasInitialStage)) {
      return;
    }
    flushPendingSave();
    activeStageRef.current = stage;
    setActiveStage(stage);
    onSelectionChange([]);
  };

  const copyPreviousStage = () => {
    if (!canEdit || activeStage === "INITIAL" || !previousSnapshot) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingDataRef.current = null;
    }
    setStageRecords((current) => ({
      ...current,
      [activeStage]: {
        snapshot: previousSnapshot,
        revision: revisionRef.current[activeStage] ?? 0,
        updatedAt: current[activeStage]?.updatedAt ?? "",
        updatedAtIso: current[activeStage]?.updatedAtIso ?? "",
      },
    }));
    setChartVersions((current) => ({
      ...current,
      [activeStage]: current[activeStage] + 1,
    }));
    onSelectionChange([]);
    setStageSaveState(setSaveStates, activeStage, "pending");
    queueSave(activeStage, previousSnapshot);
  };

  return (
    <div className="patient-odontogram-editor">
      <div
        className="odontogram-stage-switcher"
        role="tablist"
        aria-label={
          language === "vi"
            ? "Các mốc odontogram điều trị"
            : "Treatment odontogram stages"
        }
      >
        {odontogramStages.map((stage, index) => (
          <div className="odontogram-stage-step" key={stage}>
            {index > 0 ? <ChevronRight aria-hidden="true" size={16} /> : null}
            <button
              aria-selected={activeStage === stage}
              className={activeStage === stage ? "active" : undefined}
              data-stage={stage.toLowerCase()}
              disabled={stage !== "INITIAL" && !hasInitialStage}
              onClick={() => switchStage(stage)}
              role="tab"
              type="button"
            >
              <span>{index + 1}</span>
              {stageLabels[language][stage]}
            </button>
          </div>
        ))}
      </div>

      <div className="odontogram-stage-context" data-stage={activeStage.toLowerCase()}>
        <div>
          <strong>{stageLabels[language][activeStage]}</strong>
          <span>{stageDescriptions[language][activeStage]}</span>
        </div>
        {activeStage !== "INITIAL" && previousSnapshot ? (
          <div className="odontogram-stage-difference">
            <span>
              {differenceLabel(language, difference)}
            </span>
            <button
              disabled={!canEdit}
              onClick={copyPreviousStage}
              title={copyLabels[language][activeStage]}
              type="button"
            >
              <Copy aria-hidden="true" size={15} />
              {copyLabels[language][activeStage]}
            </button>
          </div>
        ) : null}
      </div>

      <div className="patient-odontogram-save-state" aria-live="polite">
        <strong data-state={activeSaveState}>
          {saveLabels[language][activeSaveState]}
        </strong>
        {activeSaveState === "saved" && activeRecord?.updatedAt ? (
          <span>{activeRecord.updatedAt}</span>
        ) : null}
        {saveMessages[activeStage] ? (
          <span>{saveMessages[activeStage]}</span>
        ) : null}
      </div>

      <Odontogram
        assetBaseUrl="/api/odontogram-assets"
        defaultValue={activeSnapshot}
        embedded
        key={`${patientId}:${activeStage}:${chartVersions[activeStage]}`}
        onChange={handleChange}
        onSelectionChange={onSelectionChange}
        readOnly={!canEdit}
        selectedTeeth={selectedTeeth}
      />
    </div>
  );
}

function recordsFromSummary(
  summary: PatientOdontogramSummary | null,
): StageRecords {
  return (
    summary?.stages ?? {
      INITIAL: null,
      EXPECTED: null,
      CURRENT: null,
    }
  );
}

function revisionsFromSummary(summary: PatientOdontogramSummary | null) {
  return {
    INITIAL: summary?.stages.INITIAL?.revision ?? null,
    EXPECTED: summary ? (summary.stages.EXPECTED?.revision ?? 0) : null,
    CURRENT: summary?.stages.CURRENT?.revision ?? null,
  } satisfies Record<PatientOdontogramStage, number | null>;
}

function saveStatesFromSummary(
  summary: PatientOdontogramSummary | null,
): StageSaveStates {
  return {
    INITIAL: summary?.stages.INITIAL ? "saved" : "idle",
    EXPECTED: summary?.stages.EXPECTED ? "saved" : "idle",
    CURRENT: summary?.stages.CURRENT ? "saved" : "idle",
  };
}

function setStageSaveState(
  setter: React.Dispatch<React.SetStateAction<StageSaveStates>>,
  stage: PatientOdontogramStage,
  state: SaveState,
) {
  setter((current) => ({ ...current, [stage]: state }));
}

function setStageMessage(
  setter: React.Dispatch<
    React.SetStateAction<Record<PatientOdontogramStage, string>>
  >,
  stage: PatientOdontogramStage,
  message: string,
) {
  setter((current) => ({ ...current, [stage]: message }));
}

function formatSavedAt(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function compareSnapshots(
  previous: OdontogramData | undefined,
  current: OdontogramData | undefined,
) {
  if (!previous || !current) {
    return { archChanged: false, teeth: [] };
  }

  const changed = new Set<string>();
  compareKeyedState(previous.surfaceState, current.surfaceState, changed);
  compareKeyedState(previous.anatomyState, current.anatomyState, changed);
  compareKeyedState(previous.markerState, current.markerState, changed);

  const previousBridges = new Map(
    previous.bridges.map((bridge) => [bridge.id, bridge.teeth]),
  );
  const currentBridges = new Map(
    current.bridges.map((bridge) => [bridge.id, bridge.teeth]),
  );
  for (const bridgeId of new Set([
    ...previousBridges.keys(),
    ...currentBridges.keys(),
  ])) {
    if (
      JSON.stringify(previousBridges.get(bridgeId)) !==
      JSON.stringify(currentBridges.get(bridgeId))
    ) {
      for (const tooth of [
        ...(previousBridges.get(bridgeId) ?? []),
        ...(currentBridges.get(bridgeId) ?? []),
      ]) {
        changed.add(tooth);
      }
    }
  }

  return {
    archChanged:
      JSON.stringify(previous.quickDiagnosis) !==
      JSON.stringify(current.quickDiagnosis),
    teeth: [...changed].sort((left, right) =>
      left.localeCompare(right, "en", { numeric: true }),
    ),
  };
}

function compareKeyedState(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
  changed: Set<string>,
) {
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(current),
  ])) {
    if (previous[key] !== current[key]) {
      changed.add(key.split(".")[0]);
    }
  }
}

function differenceLabel(
  language: Language,
  difference: { archChanged: boolean; teeth: string[] },
) {
  const { archChanged, teeth } = difference;
  if (teeth.length === 0 && !archChanged) {
    return language === "vi"
      ? "Chưa có thay đổi so với mốc trước"
      : "No changes from the previous stage";
  }

  if (teeth.length === 0) {
    return language === "vi"
      ? "Đã thay đổi chẩn đoán tương quan hàm"
      : "Arch diagnosis changed";
  }

  const toothList = teeth.slice(0, 8).map((tooth) => `R${tooth}`).join(", ");
  const remaining = teeth.length - 8;
  if (language === "vi") {
    return `${teeth.length} răng thay đổi: ${toothList}${
      remaining > 0 ? ` và ${remaining} răng khác` : ""
    }${archChanged ? " · Có thay đổi tương quan hàm" : ""}`;
  }
  return `${teeth.length} changed teeth: ${toothList}${
    remaining > 0 ? ` and ${remaining} more` : ""
  }${archChanged ? " · Arch diagnosis changed" : ""}`;
}
