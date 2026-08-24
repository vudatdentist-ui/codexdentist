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
} from "@/features/patient-360/server/odontogram-actions";
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
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const stageDataRef = useRef<Record<PatientOdontogramStage, OdontogramData>>({
    INITIAL: stageRecords.INITIAL?.data ?? { teeth: {} },
    EXPECTED: stageRecords.EXPECTED?.data ?? { teeth: {} },
    CURRENT: stageRecords.CURRENT?.data ?? { teeth: {} },
  });
  const [stageData, setStageData] = useState(stageDataRef.current);

  useEffect(() => {
    const nextRecords = recordsFromSummary(initialOdontogram);
    const nextData = {
      INITIAL: nextRecords.INITIAL?.data ?? { teeth: {} },
      EXPECTED: nextRecords.EXPECTED?.data ?? { teeth: {} },
      CURRENT: nextRecords.CURRENT?.data ?? { teeth: {} },
    } satisfies Record<PatientOdontogramStage, OdontogramData>;
    setStageRecords(nextRecords);
    setSaveStates(saveStatesFromSummary(initialOdontogram));
    setStageData(nextData);
    stageDataRef.current = nextData;
    revisionRef.current = revisionsFromSummary(initialOdontogram);
  }, [initialOdontogram]);

  useEffect(() => {
    activeStageRef.current = activeStage;
  }, [activeStage]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const persistStage = useCallback(
    async (stage: PatientOdontogramStage, data: OdontogramData) => {
      if (!canEdit) {
        return;
      }

      const expectedRevision = revisionRef.current[stage];
      setSaveStates((current) => ({ ...current, [stage]: "saving" }));
      setSaveMessages((current) => ({ ...current, [stage]: "" }));

      saveQueueRef.current = saveQueueRef.current.then(async () => {
        const result = await savePatientOdontogramAction({
          patientId,
          stage,
          expectedRevision,
          data,
        });

        if (!result.ok) {
          setSaveStates((current) => ({ ...current, [stage]: "error" }));
          setSaveMessages((current) => ({
            ...current,
            [stage]: result.message,
          }));
          return;
        }

        revisionRef.current[stage] = result.stage.revision;
        setStageRecords((current) => ({ ...current, [stage]: result.stage }));
        setSaveStates((current) => ({ ...current, [stage]: "saved" }));
        setSaveMessages((current) => ({ ...current, [stage]: result.message }));
      });

      await saveQueueRef.current;
    },
    [canEdit, patientId],
  );

  const schedulePersist = useCallback(
    (stage: PatientOdontogramStage, data: OdontogramData) => {
      if (!canEdit) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setSaveStates((current) => ({ ...current, [stage]: "pending" }));
      timerRef.current = setTimeout(() => {
        void persistStage(stage, data);
      }, 550);
    },
    [canEdit, persistStage],
  );

  const activeData = stageData[activeStage];
  const activeRecord = stageRecords[activeStage];
  const selectedStageLabel = stageLabels[language][activeStage];
  const saveLabel = saveLabels[language][saveStates[activeStage]];
  const saveMessage = saveMessages[activeStage];
  const stageTabs = useMemo(
    () =>
      odontogramStages.map((stage) => ({
        stage,
        label: stageLabels[language][stage],
        record: stageRecords[stage],
      })),
    [language, stageRecords],
  );

  async function copyStage(
    sourceStage: PatientOdontogramStage,
    targetStage: PatientOdontogramStage,
  ) {
    if (!canEdit) return;
    const sourceData = stageDataRef.current[sourceStage];
    const nextData = structuredClone(sourceData);
    stageDataRef.current = { ...stageDataRef.current, [targetStage]: nextData };
    setStageData((current) => ({ ...current, [targetStage]: nextData }));
    setActiveStage(targetStage);
    setChartVersions((current) => ({
      ...current,
      [targetStage]: current[targetStage] + 1,
    }));
    await persistStage(targetStage, nextData);
  }

  async function resetStage(stage: PatientOdontogramStage) {
    if (!canEdit) return;
    const result = await resetPatientOdontogramStagesAction({
      patientId,
      stage,
      expectedRevision: revisionRef.current[stage],
    });

    if (!result.ok) {
      setSaveStates((current) => ({ ...current, [stage]: "error" }));
      setSaveMessages((current) => ({ ...current, [stage]: result.message }));
      return;
    }

    revisionRef.current[stage] = result.stage.revision;
    const nextData = result.stage.data;
    stageDataRef.current = { ...stageDataRef.current, [stage]: nextData };
    setStageData((current) => ({ ...current, [stage]: nextData }));
    setStageRecords((current) => ({ ...current, [stage]: result.stage }));
    setChartVersions((current) => ({ ...current, [stage]: current[stage] + 1 }));
    setSaveStates((current) => ({ ...current, [stage]: "saved" }));
    setSaveMessages((current) => ({ ...current, [stage]: result.message }));
    setResetMenuOpen(false);
  }

  return (
    <section className="patient-odontogram-card">
      <div className="patient-odontogram-stage-tabs" role="tablist" aria-label="Các mốc odontogram">
        {stageTabs.map(({ stage, label, record }) => (
          <button
            aria-selected={activeStage === stage}
            className={`patient-odontogram-stage-tab${activeStage === stage ? " active" : ""}`}
            key={stage}
            onClick={() => setActiveStage(stage)}
            role="tab"
            type="button"
          >
            <span>{label}</span>
            <small>{record ? `v${record.revision}` : "—"}</small>
          </button>
        ))}
      </div>

      <div className="patient-odontogram-toolbar">
        <div>
          <strong>{selectedStageLabel}</strong>
          <span>{stageDescriptions[language][activeStage]}</span>
        </div>
        <div className="patient-odontogram-toolbar-actions">
          {activeStage === "CURRENT" ? (
            <button
              className="journey-inline-button"
              disabled={!canEdit || !stageRecords.INITIAL}
              onClick={() => void copyStage("INITIAL", "CURRENT")}
              type="button"
            >
              <Copy size={14} />
              {copyLabels[language].CURRENT}
            </button>
          ) : null}
          {activeStage === "EXPECTED" ? (
            <button
              className="journey-inline-button"
              disabled={!canEdit || !stageRecords.CURRENT}
              onClick={() => void copyStage("CURRENT", "EXPECTED")}
              type="button"
            >
              <Copy size={14} />
              {copyLabels[language].EXPECTED}
            </button>
          ) : null}
          {canEdit ? (
            <div className="patient-odontogram-reset-menu">
              <button
                aria-expanded={resetMenuOpen}
                aria-label={language === "vi" ? "Tùy chọn odontogram" : "Odontogram options"}
                className="journey-icon-button"
                onClick={() => setResetMenuOpen((current) => !current)}
                type="button"
              >
                <Ellipsis size={16} />
              </button>
              {resetMenuOpen ? (
                <div className="patient-odontogram-reset-popover">
                  <button
                    disabled={!activeRecord}
                    onClick={() => void resetStage(activeStage)}
                    type="button"
                  >
                    <Trash2 size={14} />
                    {language === "vi" ? "Đặt lại mốc này" : "Reset this stage"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Odontogram
        key={`${activeStage}-${chartVersions[activeStage]}`}
        data={activeData}
        onChange={(nextData) => {
          stageDataRef.current = { ...stageDataRef.current, [activeStage]: nextData };
          setStageData((current) => ({ ...current, [activeStage]: nextData }));
          schedulePersist(activeStage, nextData);
        }}
        onSelectionChange={onSelectionChange}
        readOnly={!canEdit}
        selectedTeeth={selectedTeeth}
      />

      <div className={`patient-odontogram-save-state ${saveStates[activeStage]}`}>
        <span>{saveLabel}</span>
        {saveMessage ? <small>{saveMessage}</small> : null}
      </div>

      {chartFooter ? (
        <div className="patient-odontogram-footer">
          {chartFooter}
          <ChevronRight size={16} aria-hidden="true" />
        </div>
      ) : null}
    </section>
  );
}

function recordsFromSummary(summary: PatientOdontogramSummary | null): StageRecords {
  return {
    INITIAL: summary?.stages.INITIAL ?? null,
    EXPECTED: summary?.stages.EXPECTED ?? null,
    CURRENT: summary?.stages.CURRENT ?? null,
  };
}

function revisionsFromSummary(summary: PatientOdontogramSummary | null) {
  return {
    INITIAL: summary?.stages.INITIAL?.revision ?? 0,
    EXPECTED: summary?.stages.EXPECTED?.revision ?? 0,
    CURRENT: summary?.stages.CURRENT?.revision ?? 0,
  } satisfies Record<PatientOdontogramStage, number>;
}

function saveStatesFromSummary(summary: PatientOdontogramSummary | null): StageSaveStates {
  return {
    INITIAL: summary?.stages.INITIAL ? "saved" : "idle",
    EXPECTED: summary?.stages.EXPECTED ? "saved" : "idle",
    CURRENT: summary?.stages.CURRENT ? "saved" : "idle",
  };
}
