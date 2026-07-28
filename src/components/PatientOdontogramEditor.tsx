"use client";

import {
  Odontogram,
  type OdontogramData,
} from "codexdentist-odontogram";
import { ChevronRight, Copy, Ellipsis, Trash2 } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  resetPatientOdontogramStagesAction,
  savePatientOdontogramAction,
} from "@/app/(app)/journey/odontogram-actions";
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
    CURRENT: "Tình trạng hiện tại",
  },
  en: {
    INITIAL: "Initial condition",
    EXPECTED: "Expected result",
    CURRENT: "Current condition",
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
    EXPECTED: "Sao chép tình trạng hiện tại",
    CURRENT: "Sao chép hiện trạng ban đầu",
  },
  en: {
    EXPECTED: "Copy current condition",
    CURRENT: "Copy initial condition",
  },
};

export function PatientOdontogramEditor({
  canEdit,
  chartFooter,
  initialOdontogram,
  language,
  onSelectionChange,
  patientId,
  selectedTeeth,
}: {
  canEdit: boolean;
  chartFooter?: ReactNode;
  initialOdontogram: PatientOdontogramSummary | null;
  language: Language;
  onSelectionChange: (teeth: string[]) => void;
  patientId: string;
  selectedTeeth: string[];
}) {
  const [activeStage, setActiveStage] =
    useState<PatientOdontogramStage>("INITIAL");
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
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
    setResetMenuOpen(false);
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
  const currentSnapshot =
    stageRecords.CURRENT?.snapshot ?? initialSnapshot;
  const expectedSnapshot =
    stageRecords.EXPECTED?.snapshot ?? currentSnapshot ?? initialSnapshot;
  const snapshots = {
    INITIAL: initialSnapshot,
    EXPECTED: expectedSnapshot,
    CURRENT: currentSnapshot,
  } satisfies Record<PatientOdontogramStage, OdontogramData | undefined>;
  const activeSnapshot = snapshots[activeStage];
  const previousSnapshot =
    activeStage === "CURRENT"
      ? initialSnapshot
      : activeStage === "EXPECTED"
        ? currentSnapshot
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
    setResetMenuOpen(false);
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
    setResetMenuOpen(false);
    queueSave(activeStage, previousSnapshot);
  };

  const cancelPendingSave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingDataRef.current = null;
  };

  const resetActiveStage = () => {
    if (!canEdit || !activeSnapshot) {
      return;
    }
    const message =
      language === "vi"
        ? `Xóa toàn bộ trạng thái trong “${stageLabels.vi[activeStage]}”?`
        : `Clear every condition in “${stageLabels.en[activeStage]}”?`;
    if (!window.confirm(message)) {
      return;
    }

    cancelPendingSave();
    const blank = createEmptyOdontogramData();
    setStageRecords((current) => ({
      ...current,
      [activeStage]: {
        snapshot: blank,
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
    setStageMessage(setSaveMessages, activeStage, "");
    setStageSaveState(setSaveStates, activeStage, "pending");
    setResetMenuOpen(false);
    queueSave(activeStage, blank);
  };

  const resetAllStages = () => {
    if (!canEdit || !hasInitialStage) {
      return;
    }
    const message =
      language === "vi"
        ? "Xóa toàn bộ trạng thái của cả 3 mốc điều trị?"
        : "Clear every condition from all three treatment stages?";
    if (!window.confirm(message)) {
      return;
    }

    cancelPendingSave();
    const blanks = {
      INITIAL: createEmptyOdontogramData(),
      CURRENT: createEmptyOdontogramData(),
      EXPECTED: createEmptyOdontogramData(),
    } satisfies Record<PatientOdontogramStage, OdontogramData>;
    setStageRecords((current) =>
      Object.fromEntries(
        odontogramStages.map((stage) => [
          stage,
          {
            snapshot: blanks[stage],
            revision: revisionRef.current[stage] ?? 0,
            updatedAt: current[stage]?.updatedAt ?? "",
            updatedAtIso: current[stage]?.updatedAtIso ?? "",
          },
        ]),
      ) as StageRecords,
    );
    setChartVersions((current) => ({
      INITIAL: current.INITIAL + 1,
      CURRENT: current.CURRENT + 1,
      EXPECTED: current.EXPECTED + 1,
    }));
    onSelectionChange([]);
    setSaveMessages({
      INITIAL: "",
      CURRENT: "",
      EXPECTED: "",
    });
    setSaveStates({
      INITIAL: "pending",
      CURRENT: "pending",
      EXPECTED: "pending",
    });
    setResetMenuOpen(false);
    const generation = generationRef.current;
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        if (generation !== generationRef.current) {
          return;
        }

        setSaveStates({
          INITIAL: "saving",
          CURRENT: "saving",
          EXPECTED: "saving",
        });
        const result = await resetPatientOdontogramStagesAction({
          patientId,
          expectedRevisions: { ...revisionRef.current },
        });

        if (generation !== generationRef.current) {
          return;
        }
        if (!result.ok) {
          setSaveStates({
            INITIAL: "error",
            CURRENT: "error",
            EXPECTED: "error",
          });
          setSaveMessages({
            INITIAL: result.message,
            CURRENT: result.message,
            EXPECTED: result.message,
          });
          return;
        }

        const updatedAt = formatSavedAt(result.updatedAt, languageRef.current);
        revisionRef.current = { ...result.revisions };
        setStageRecords(
          Object.fromEntries(
            odontogramStages.map((stage) => [
              stage,
              {
                snapshot: blanks[stage],
                revision: result.revisions[stage],
                updatedAt,
                updatedAtIso: result.updatedAt,
              },
            ]),
          ) as StageRecords,
        );
        setSaveStates({
          INITIAL: "saved",
          CURRENT: "saved",
          EXPECTED: "saved",
        });
      })
      .catch(() => {
        if (generation === generationRef.current) {
          const message =
            languageRef.current === "vi"
              ? "Chưa reset được odontogram. Vui lòng thử lại."
              : "The odontogram could not be reset. Please try again.";
          setSaveStates({
            INITIAL: "error",
            CURRENT: "error",
            EXPECTED: "error",
          });
          setSaveMessages({
            INITIAL: message,
            CURRENT: message,
            EXPECTED: message,
          });
        }
      });
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
        <div className="odontogram-stage-actions">
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
          {canEdit ? (
            <div className="odontogram-stage-reset-menu">
              <button
                aria-expanded={resetMenuOpen}
                aria-label={
                  language === "vi" ? "Mở thao tác xóa" : "Open clear actions"
                }
                className="odontogram-stage-menu-trigger"
                onClick={() => setResetMenuOpen((current) => !current)}
                title={language === "vi" ? "Thao tác xóa" : "Clear actions"}
                type="button"
              >
                <Ellipsis aria-hidden="true" size={17} />
              </button>
              {resetMenuOpen ? (
                <div className="odontogram-stage-reset-popover">
                  <button
                    disabled={!activeSnapshot}
                    onClick={resetActiveStage}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    {language === "vi"
                      ? "Xóa mốc đang mở"
                      : "Clear current stage"}
                  </button>
                  <button
                    disabled={!hasInitialStage}
                    onClick={resetAllStages}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    {language === "vi" ? "Xóa cả 3 mốc" : "Clear all stages"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
        chartFooter={chartFooter}
        defaultValue={activeSnapshot}
        embedded
        hideResetAction
        key={`${patientId}:${activeStage}:${chartVersions[activeStage]}`}
        onChange={handleChange}
        onSelectionChange={onSelectionChange}
        readOnly={!canEdit}
        selectedTeeth={selectedTeeth}
      />
    </div>
  );
}

function createEmptyOdontogramData(): OdontogramData {
  return {
    version: 2,
    entries: [],
    generalAssessment: {
      both: {},
      upper: {},
      lower: {},
      notes: {
        both: "",
        upper: "",
        lower: "",
      },
    },
  };
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
  const previousEntries = new Map(
    previous.entries.map((entry) => [entry.id, entry]),
  );
  const currentEntries = new Map(
    current.entries.map((entry) => [entry.id, entry]),
  );
  for (const entryId of new Set([
    ...previousEntries.keys(),
    ...currentEntries.keys(),
  ])) {
    const previousEntry = previousEntries.get(entryId);
    const currentEntry = currentEntries.get(entryId);
    if (
      JSON.stringify(previousEntry) !== JSON.stringify(currentEntry)
    ) {
      for (const tooth of [
        ...(previousEntry?.target.teeth ?? []),
        ...(currentEntry?.target.teeth ?? []),
      ]) {
        changed.add(tooth);
      }
    }
  }

  return {
    archChanged:
      JSON.stringify(previous.generalAssessment) !==
      JSON.stringify(current.generalAssessment),
    teeth: [...changed].sort((left, right) =>
      left.localeCompare(right, "en", { numeric: true }),
    ),
  };
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
      ? "Đã thay đổi đánh giá tổng quát"
      : "General assessment changed";
  }

  const toothList = teeth.slice(0, 8).map((tooth) => `R${tooth}`).join(", ");
  const remaining = teeth.length - 8;
  if (language === "vi") {
    return `${teeth.length} răng thay đổi: ${toothList}${
      remaining > 0 ? ` và ${remaining} răng khác` : ""
  }${archChanged ? " · Có thay đổi đánh giá tổng quát" : ""}`;
  }
  return `${teeth.length} changed teeth: ${toothList}${
    remaining > 0 ? ` and ${remaining} more` : ""
  }${archChanged ? " · General assessment changed" : ""}`;
}
