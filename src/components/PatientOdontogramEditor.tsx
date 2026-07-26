"use client";

import {
  Odontogram,
  type OdontogramData,
} from "codexdentist-odontogram";
import { useCallback, useEffect, useRef, useState } from "react";
import { savePatientOdontogramAction } from "@/app/(app)/journey/odontogram-actions";
import type { Language } from "@/components/AppLanguage";
import type { PatientOdontogramSummary } from "@/lib/journey-records-types";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const saveLabels: Record<Language, Record<SaveState, string>> = {
  vi: {
    idle: "Chưa có dữ liệu đã lưu",
    pending: "Đang chờ lưu",
    saving: "Đang lưu",
    saved: "Đã lưu",
    error: "Chưa lưu được",
  },
  en: {
    idle: "No saved chart",
    pending: "Waiting to save",
    saving: "Saving",
    saved: "Saved",
    error: "Not saved",
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
  const [saveState, setSaveState] = useState<SaveState>(
    initialOdontogram ? "saved" : "idle",
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [savedAt, setSavedAt] = useState(initialOdontogram?.updatedAt ?? "");
  const revisionRef = useRef<number | null>(
    initialOdontogram?.revision ?? null,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    generationRef.current += 1;
    revisionRef.current = initialOdontogram?.revision ?? null;
    setSaveState(initialOdontogram ? "saved" : "idle");
    setSaveMessage("");
    setSavedAt(initialOdontogram?.updatedAt ?? "");

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [initialOdontogram, patientId]);

  const queueSave = useCallback(
    (data: OdontogramData) => {
      const generation = generationRef.current;
      saveChainRef.current = saveChainRef.current
        .then(async () => {
          if (generation !== generationRef.current) {
            return;
          }

          setSaveState("saving");
          const result = await savePatientOdontogramAction({
            patientId,
            expectedRevision: revisionRef.current,
            data,
          });

          if (generation !== generationRef.current) {
            return;
          }

          if (!result.ok) {
            setSaveState("error");
            setSaveMessage(result.message);
            return;
          }

          revisionRef.current = result.revision;
          setSaveState("saved");
          setSaveMessage("");
          setSavedAt(
            new Intl.DateTimeFormat(
              languageRef.current === "vi" ? "vi-VN" : "en-GB",
              {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Asia/Bangkok",
              },
            ).format(new Date(result.updatedAt)),
          );
        })
        .catch(() => {
          if (generation === generationRef.current) {
            setSaveState("error");
            setSaveMessage(
              languageRef.current === "vi"
                ? "Chưa lưu được odontogram. Vui lòng thử lại."
                : "The odontogram could not be saved. Please try again.",
            );
          }
        });
    },
    [patientId],
  );

  const handleChange = useCallback(
    (data: OdontogramData) => {
      if (!canEdit) {
        return;
      }

      setSaveState("pending");
      setSaveMessage("");
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => queueSave(data), 700);
    },
    [canEdit, queueSave],
  );

  return (
    <div className="patient-odontogram-editor">
      <div className="patient-odontogram-save-state" aria-live="polite">
        <strong data-state={saveState}>{saveLabels[language][saveState]}</strong>
        {saveState === "saved" && savedAt ? <span>{savedAt}</span> : null}
        {saveMessage ? <span>{saveMessage}</span> : null}
      </div>
      <Odontogram
        assetBaseUrl="/api/odontogram-assets"
        defaultValue={initialOdontogram?.snapshot}
        embedded
        onChange={handleChange}
        onSelectionChange={onSelectionChange}
        readOnly={!canEdit}
        selectedTeeth={selectedTeeth}
      />
    </div>
  );
}
