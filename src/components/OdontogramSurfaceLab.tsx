"use client";

import {
  Check,
  Clipboard,
  Download,
  RotateCcw,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "@/app/odontogram/odontogram.module.css";

const adultUpperTeeth = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
] as const;

const adultLowerTeeth = [
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38",
] as const;

const primaryUpperTeeth = [
  "55", "54", "53", "52", "51", "61", "62", "63", "64", "65",
] as const;

const primaryLowerTeeth = [
  "85", "84", "83", "82", "81", "71", "72", "73", "74", "75",
] as const;

const allTeeth = [
  ...adultUpperTeeth,
  ...adultLowerTeeth,
  ...primaryUpperTeeth,
  ...primaryLowerTeeth,
] as const;

const conditionOptions = [
  { id: "caries", label: "Sâu răng", shortLabel: "Sâu", color: "#d64045" },
  { id: "existing", label: "Phục hồi hiện có", shortLabel: "Hiện có", color: "#2878b5" },
  { id: "planned", label: "Điều trị dự kiến", shortLabel: "Dự kiến", color: "#d18a12" },
  { id: "watch", label: "Theo dõi", shortLabel: "Theo dõi", color: "#14866d" },
] as const;

const clinicalMarkerOptions = [
  { id: "pulpitis", label: "Viêm tủy", shortLabel: "VT", color: "#d64045" },
  {
    id: "periodontitis",
    label: "Viêm quanh răng",
    shortLabel: "QR",
    color: "#c0363c",
  },
  {
    id: "periapical",
    label: "Tổn thương quanh chóp",
    shortLabel: "QC",
    color: "#b8323a",
  },
  { id: "implant", label: "Implant", shortLabel: "IM", color: "#2878b5" },
  {
    id: "rootCanal",
    label: "Đã điều trị tủy",
    shortLabel: "TT",
    color: "#7256a8",
  },
  { id: "crown", label: "Mão răng", shortLabel: "MR", color: "#d18a12" },
  { id: "missing", label: "Mất răng", shortLabel: "MT", color: "#68777c" },
  {
    id: "extraction",
    label: "Chỉ định nhổ",
    shortLabel: "CN",
    color: "#d64045",
  },
  { id: "fracture", label: "Nứt / gãy", shortLabel: "NG", color: "#d36b28" },
] as const;

type ToothId = (typeof allTeeth)[number];
type Dentition = "adult" | "primary";
type SurfaceCode = "M" | "D" | "B" | "L" | "O" | "I";
type ConditionId = (typeof conditionOptions)[number]["id"];
type ClinicalMarkerId = (typeof clinicalMarkerOptions)[number]["id"];
type NativeMarkerId =
  | "pulpitis"
  | "periodontitis"
  | "periapical"
  | "rootCanal"
  | "crown"
  | "extraction";
type SurfaceState = Record<string, ConditionId>;
type MarkerState = Record<string, true>;
type HistoryEntry = {
  surfaceState: SurfaceState;
  markerState: MarkerState;
};

const nativeMarkerIds = new Set<ClinicalMarkerId>([
  "pulpitis",
  "periodontitis",
  "periapical",
  "rootCanal",
  "crown",
  "extraction",
]);

const markerConflicts: Record<ClinicalMarkerId, ClinicalMarkerId[]> = {
  missing: clinicalMarkerOptions.map((marker) => marker.id),
  implant: [
    "missing",
    "pulpitis",
    "rootCanal",
    "periapical",
    "fracture",
    "extraction",
  ],
  pulpitis: ["missing", "implant", "rootCanal"],
  rootCanal: ["missing", "implant", "pulpitis"],
  crown: ["missing", "fracture"],
  fracture: ["missing", "implant", "crown"],
  extraction: ["missing", "implant"],
  periodontitis: ["missing"],
  periapical: ["missing", "implant"],
};

const surfaceNames: Record<SurfaceCode, string> = {
  M: "Mesial",
  D: "Distal",
  B: "Buccal",
  L: "Lingual / Palatal",
  O: "Occlusal",
  I: "Incisal",
};

const storageKey = "codexdentist-odontogram-5-surface-v1";
const markerStorageKey = "codexdentist-odontogram-clinical-markers-v1";

function isToothId(value: string): value is ToothId {
  return allTeeth.includes(value as ToothId);
}

function isConditionId(value: unknown): value is ConditionId {
  return conditionOptions.some((condition) => condition.id === value);
}

function isClinicalMarkerId(value: unknown): value is ClinicalMarkerId {
  return clinicalMarkerOptions.some((marker) => marker.id === value);
}

function parseStoredState(value: string | null): SurfaceState {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([key, condition]) => {
        const [tooth, surface] = key.split(".");
        return (
          isToothId(tooth) &&
          ["M", "D", "B", "L", "O", "I"].includes(surface) &&
          isConditionId(condition)
        );
      }),
    ) as SurfaceState;
  } catch {
    return {};
  }
}

function parseStoredMarkerState(value: string | null): MarkerState {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([key, enabled]) => {
        const [tooth, marker] = key.split(".");
        return isToothId(tooth) && isClinicalMarkerId(marker) && enabled === true;
      }),
    ) as MarkerState;
  } catch {
    return {};
  }
}

function readStoredState() {
  try {
    return parseStoredState(window.localStorage.getItem(storageKey));
  } catch {
    return {};
  }
}

function readStoredMarkerState() {
  try {
    return parseStoredMarkerState(
      window.localStorage.getItem(markerStorageKey),
    );
  } catch {
    return {};
  }
}

function normalizeStoredState(
  surfaceState: SurfaceState,
  markerState: MarkerState,
) {
  const nextSurfaces = { ...surfaceState };
  const nextMarkers = { ...markerState };

  for (const tooth of allTeeth) {
    if (hasMarker(nextMarkers, tooth, "missing")) {
      for (const marker of clinicalMarkerOptions) {
        if (marker.id !== "missing") {
          delete nextMarkers[markerKey(tooth, marker.id)];
        }
      }
      for (const surface of toothSurfaces(tooth)) {
        delete nextSurfaces[surfaceKey(tooth, surface)];
      }
      continue;
    }

    if (hasMarker(nextMarkers, tooth, "implant")) {
      for (const conflict of markerConflicts.implant) {
        delete nextMarkers[markerKey(tooth, conflict)];
      }
      for (const surface of toothSurfaces(tooth)) {
        delete nextSurfaces[surfaceKey(tooth, surface)];
      }
    }

    if (
      hasMarker(nextMarkers, tooth, "pulpitis") &&
      hasMarker(nextMarkers, tooth, "rootCanal")
    ) {
      delete nextMarkers[markerKey(tooth, "pulpitis")];
    }

    if (
      hasMarker(nextMarkers, tooth, "crown") &&
      hasMarker(nextMarkers, tooth, "fracture")
    ) {
      delete nextMarkers[markerKey(tooth, "fracture")];
    }
  }

  return { surfaceState: nextSurfaces, markerState: nextMarkers };
}

function persistStoredState(state: SurfaceState) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The odontogram remains usable when browser storage is unavailable.
  }
}

function persistStoredMarkerState(state: MarkerState) {
  try {
    window.localStorage.setItem(markerStorageKey, JSON.stringify(state));
  } catch {
    // The odontogram remains usable when browser storage is unavailable.
  }
}

function surfaceKey(tooth: ToothId, surface: SurfaceCode) {
  return `${tooth}.${surface}`;
}

function markerKey(tooth: ToothId, marker: ClinicalMarkerId) {
  return `${tooth}.${marker}`;
}

function hasMarker(
  state: MarkerState,
  tooth: ToothId,
  marker: ClinicalMarkerId,
) {
  return state[markerKey(tooth, marker)] === true;
}

function isToothUnavailable(state: MarkerState, tooth: ToothId) {
  return hasMarker(state, tooth, "missing") || hasMarker(state, tooth, "implant");
}

function toothPosition(tooth: ToothId) {
  return Number(tooth[1]);
}

function isPrimaryTooth(tooth: ToothId) {
  return Number(tooth[0]) >= 5;
}

function isUpperTooth(tooth: ToothId) {
  return [1, 2, 5, 6].includes(Number(tooth[0]));
}

function isRightQuadrant(tooth: ToothId) {
  return [1, 4, 5, 8].includes(Number(tooth[0]));
}

function isPatientLeft(tooth: ToothId) {
  return [2, 3, 6, 7].includes(Number(tooth[0]));
}

function isAnterior(tooth: ToothId) {
  return toothPosition(tooth) <= 3;
}

function toothType(tooth: ToothId) {
  const position = toothPosition(tooth);

  if (isPrimaryTooth(tooth)) {
    if (position <= 2) return "Răng cửa sữa";
    if (position === 3) return "Răng nanh sữa";
    return "Răng hàm sữa";
  }

  if (position <= 2) return "Răng cửa";
  if (position === 3) return "Răng nanh";
  if (position <= 5) return "Răng hàm nhỏ";
  return "Răng hàm lớn";
}

type ToothTemplate = "11" | "13" | "14" | "16";

function toothTemplate(tooth: ToothId): ToothTemplate {
  const position = toothPosition(tooth);

  if (position <= 2) return "11";
  if (position === 3) return "13";
  if (isPrimaryTooth(tooth) || position <= 5) return "14";
  return "16";
}

function toothArtworkPath(
  tooth: ToothId,
  variant?: "implant" | NativeMarkerId,
) {
  const dentition = isPrimaryTooth(tooth) ? "primary" : "adult";
  const suffix = variant ? `-${variant}` : "";
  const fileName = `${toothTemplate(tooth)}-${dentition}${suffix}.svg`;
  return variant
    ? `/api/odontogram-assets/${fileName}`
    : `/odontogram-assets/${fileName}`;
}

function toothSurfaces(tooth: ToothId): SurfaceCode[] {
  return ["M", "D", "B", "L", isAnterior(tooth) ? "I" : "O"];
}

function surfaceLayout(tooth: ToothId) {
  const upper = isUpperTooth(tooth);
  const rightQuadrant = isRightQuadrant(tooth);

  return {
    top: upper ? "B" : "L",
    right: rightQuadrant ? "M" : "D",
    bottom: upper ? "L" : "B",
    left: rightQuadrant ? "D" : "M",
    center: isAnterior(tooth) ? "I" : "O",
  } satisfies Record<"top" | "right" | "bottom" | "left" | "center", SurfaceCode>;
}

function conditionFor(id?: ConditionId) {
  return conditionOptions.find((condition) => condition.id === id);
}

function markerFor(id: ClinicalMarkerId) {
  return clinicalMarkerOptions.find((marker) => marker.id === id);
}

function buildExportData(
  surfaceState: SurfaceState,
  markerState: MarkerState,
  dentition: Dentition,
) {
  const surfaces = Object.entries(surfaceState).map(([key, condition]) => {
    const [tooth, surface] = key.split(".");
    return {
      tooth,
      dentition,
      surface,
      surfaceName: surfaceNames[surface as SurfaceCode],
      condition,
      conditionName: conditionFor(condition)?.label ?? condition,
    };
  });
  const markers = Object.keys(markerState).map((key) => {
    const [tooth, marker] = key.split(".");
    return {
      tooth,
      dentition,
      marker,
      markerName: markerFor(marker as ClinicalMarkerId)?.label ?? marker,
    };
  });

  return { notation: "FDI", dentition, surfaces, markers };
}

function downloadJson(
  surfaceState: SurfaceState,
  markerState: MarkerState,
  dentition: Dentition,
) {
  const blob = new Blob(
    [
      JSON.stringify(
        buildExportData(surfaceState, markerState, dentition),
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `codexdentist-odontogram-${dentition}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OdontogramSurfaceLab() {
  const [surfaceState, setSurfaceState] = useState<SurfaceState>({});
  const [markerState, setMarkerState] = useState<MarkerState>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [condition, setCondition] = useState<ConditionId>("caries");
  const [dentition, setDentition] = useState<Dentition>("adult");
  const [selectedTooth, setSelectedTooth] = useState<ToothId>("16");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const normalized = normalizeStoredState(
      readStoredState(),
      readStoredMarkerState(),
    );
    setSurfaceState(normalized.surfaceState);
    setMarkerState(normalized.markerState);
    persistStoredState(normalized.surfaceState);
    persistStoredMarkerState(normalized.markerState);
  }, []);

  const commitSurfaceState = (
    update: (current: SurfaceState) => SurfaceState,
  ) => {
    setSurfaceState((current) => {
      const next = update(current);
      persistStoredState(next);
      return next;
    });
  };

  const commitMarkerState = (
    update: (current: MarkerState) => MarkerState,
  ) => {
    setMarkerState((current) => {
      const next = update(current);
      persistStoredMarkerState(next);
      return next;
    });
  };

  const saveHistory = () => {
    const snapshot = {
      surfaceState: { ...surfaceState },
      markerState: { ...markerState },
    };
    setHistory((current) => [...current.slice(-49), snapshot]);
  };

  const upperTeeth =
    dentition === "adult" ? adultUpperTeeth : primaryUpperTeeth;
  const lowerTeeth =
    dentition === "adult" ? adultLowerTeeth : primaryLowerTeeth;
  const activeToothSet = useMemo(
    () => new Set<ToothId>([...upperTeeth, ...lowerTeeth]),
    [upperTeeth, lowerTeeth],
  );
  const activeSurfaceState = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(surfaceState).filter(([key]) =>
          activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as SurfaceState,
    [activeToothSet, surfaceState],
  );
  const activeMarkerState = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(markerState).filter(([key]) =>
          activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as MarkerState,
    [activeToothSet, markerState],
  );
  const markedSurfaceCount = Object.keys(activeSurfaceState).length;
  const markedMarkerCount = Object.keys(activeMarkerState).length;
  const markedToothCount = new Set(
    [
      ...Object.keys(activeSurfaceState),
      ...Object.keys(activeMarkerState),
    ].map((key) => key.split(".")[0]),
  ).size;

  const selectedRows = useMemo(
    () =>
      toothSurfaces(selectedTooth).map((surface) => ({
        surface,
        condition: surfaceState[surfaceKey(selectedTooth, surface)],
      })),
    [selectedTooth, surfaceState],
  );
  const selectedToothUnavailable = isToothUnavailable(
    markerState,
    selectedTooth,
  );
  const setSurface = (tooth: ToothId, surface: SurfaceCode) => {
    if (isToothUnavailable(markerState, tooth)) {
      return;
    }

    const key = surfaceKey(tooth, surface);
    const previous = surfaceState[key];

    if (previous === condition) {
      return;
    }

    setSelectedTooth(tooth);
    saveHistory();
    commitSurfaceState((current) => ({ ...current, [key]: condition }));
  };

  const clearSurface = (tooth: ToothId, surface: SurfaceCode) => {
    if (isToothUnavailable(markerState, tooth)) {
      return;
    }

    const key = surfaceKey(tooth, surface);
    const previous = surfaceState[key];

    if (!previous) {
      return;
    }

    saveHistory();
    commitSurfaceState((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const toggleMarker = (tooth: ToothId, marker: ClinicalMarkerId) => {
    const key = markerKey(tooth, marker);
    const active = markerState[key] === true;

    setSelectedTooth(tooth);
    saveHistory();

    const nextMarkers = { ...markerState };
    const nextSurfaces = { ...surfaceState };

    if (active) {
      delete nextMarkers[key];
    } else {
      for (const conflict of markerConflicts[marker]) {
        delete nextMarkers[markerKey(tooth, conflict)];
      }
      nextMarkers[key] = true;

      if (marker === "missing" || marker === "implant") {
        for (const surface of toothSurfaces(tooth)) {
          delete nextSurfaces[surfaceKey(tooth, surface)];
        }
      }
    }

    commitMarkerState(() => nextMarkers);
    commitSurfaceState(() => nextSurfaces);
  };

  const undo = () => {
    const last = history.at(-1);
    if (!last) return;

    commitSurfaceState(() => last.surfaceState);
    commitMarkerState(() => last.markerState);
    setHistory((current) => current.slice(0, -1));
  };

  const reset = () => {
    const label = dentition === "adult" ? "răng vĩnh viễn" : "răng sữa";
    if (
      (markedSurfaceCount === 0 && markedMarkerCount === 0) ||
      !window.confirm(`Xóa toàn bộ đánh dấu của bộ ${label}?`)
    ) {
      return;
    }
    saveHistory();
    commitSurfaceState((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as SurfaceState,
    );
    commitMarkerState((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as MarkerState,
    );
  };

  const copyData = async () => {
    const payload = JSON.stringify(
      buildExportData(activeSurfaceState, activeMarkerState, dentition),
      null,
      2,
    );
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const selectDentition = (nextDentition: Dentition) => {
    if (nextDentition === dentition) {
      return;
    }

    setDentition(nextDentition);
    setSelectedTooth(nextDentition === "adult" ? "16" : "55");
    setHistory([]);
    setCopied(false);
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="https://codexdentist.com">
          <img src="/icons/codexmed-icon.svg" alt="" />
          <span>
            <strong>Codexdentist</strong>
            <small>Clinical Lab</small>
          </span>
        </Link>
        <div className={styles.titleBlock}>
          <span className={styles.statusDot} />
          <div>
            <h1>Odontogram 5 mặt</h1>
            <p>
              FDI · {dentition === "adult" ? "Răng vĩnh viễn" : "Răng sữa"}
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.savedState}>
            <Check size={14} />
            Lưu cục bộ
          </span>
          <button
            className={styles.iconButton}
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            aria-label="Hoàn tác"
            title="Hoàn tác"
          >
            <Undo2 size={18} />
          </button>
          <button
            className={styles.iconButton}
            type="button"
            onClick={reset}
            disabled={markedSurfaceCount === 0 && markedMarkerCount === 0}
            aria-label="Xóa toàn bộ"
            title="Xóa toàn bộ"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section className={styles.toolbar} aria-label="Trạng thái bề mặt">
        <div className={styles.toolbarControls}>
          <div className={styles.dentitionControl} aria-label="Loại bộ răng">
            <button
              type="button"
              className={dentition === "adult" ? styles.dentitionActive : undefined}
              onClick={() => selectDentition("adult")}
              aria-pressed={dentition === "adult"}
            >
              Răng vĩnh viễn
            </button>
            <button
              type="button"
              className={dentition === "primary" ? styles.dentitionActive : undefined}
              onClick={() => selectDentition("primary")}
              aria-pressed={dentition === "primary"}
            >
              Răng sữa
            </button>
          </div>
          <div className={styles.conditionControl}>
            {conditionOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  condition === option.id ? styles.conditionActive : undefined
                }
                onClick={() => setCondition(option.id)}
                aria-pressed={condition === option.id}
              >
                <span style={{ backgroundColor: option.color }} />
                <span className={styles.fullLabel}>{option.label}</span>
                <span className={styles.shortLabel}>{option.shortLabel}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.toolbarStats}>
          <span><strong>{markedToothCount}</strong> răng</span>
          <span><strong>{markedSurfaceCount}</strong> mặt</span>
          <span><strong>{markedMarkerCount}</strong> dấu</span>
        </div>
      </section>

      <div className={styles.workspace}>
        <section className={styles.chartPanel} aria-label="Sơ đồ răng">
          <div className={styles.orientation}>
            <span>Phải bệnh nhân</span>
            <span>Đường giữa</span>
            <span>Trái bệnh nhân</span>
          </div>

          <Arch
            label="Hàm trên"
            teeth={upperTeeth}
            selectedTooth={selectedTooth}
            state={surfaceState}
            markerState={markerState}
            condition={condition}
            onSelectTooth={setSelectedTooth}
            onSetSurface={setSurface}
            onClearSurface={clearSurface}
          />

          <div className={styles.occlusalPlane}>
            <span />
            <strong>Mặt phẳng cắn</strong>
            <span />
          </div>

          <Arch
            label="Hàm dưới"
            teeth={lowerTeeth}
            selectedTooth={selectedTooth}
            state={surfaceState}
            markerState={markerState}
            condition={condition}
            onSelectTooth={setSelectedTooth}
            onSetSurface={setSurface}
            onClearSurface={clearSurface}
          />
        </section>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHeading}>
            <div>
              <span>Răng đang chọn</span>
              <h2>R{selectedTooth}</h2>
            </div>
            <strong>
              {hasMarker(markerState, selectedTooth, "implant") &&
              hasMarker(markerState, selectedTooth, "crown")
                ? "Implant + Mão"
                : hasMarker(markerState, selectedTooth, "missing")
                ? "Mất răng"
                : hasMarker(markerState, selectedTooth, "implant")
                  ? "Implant"
                  : toothType(selectedTooth)}
            </strong>
          </div>

          <div className={styles.focusTooth}>
            <SurfaceMap
              tooth={selectedTooth}
              state={surfaceState}
              condition={condition}
              large
              disabled={selectedToothUnavailable}
              onSetSurface={setSurface}
              onClearSurface={clearSurface}
            />
          </div>

          <div className={styles.surfaceList}>
            {selectedRows.map(({ surface, condition: surfaceCondition }) => (
              <button
                key={surface}
                type="button"
                disabled={selectedToothUnavailable}
                onClick={() => setSurface(selectedTooth, surface)}
              >
                <span className={styles.surfaceCode}>{surface}</span>
                <span>
                  <strong>{surfaceNames[surface]}</strong>
                  <small>
                    {conditionFor(surfaceCondition)?.label ?? "Chưa đánh dấu"}
                  </small>
                </span>
                {surfaceCondition ? (
                  <i style={{ backgroundColor: conditionFor(surfaceCondition)?.color }} />
                ) : null}
              </button>
            ))}
          </div>

          <div className={styles.clinicalMarkers}>
            <div className={styles.clinicalMarkersHeading}>
              <span>Ký hiệu lâm sàng</span>
              <strong>
                {
                  clinicalMarkerOptions.filter(
                    (marker) =>
                      markerState[markerKey(selectedTooth, marker.id)] === true,
                  ).length
                }
              </strong>
            </div>
            <div className={styles.clinicalMarkerGrid}>
              {clinicalMarkerOptions.map((marker) => {
                const active =
                  markerState[markerKey(selectedTooth, marker.id)] === true;

                return (
                  <button
                    key={marker.id}
                    type="button"
                    className={active ? styles.clinicalMarkerActive : undefined}
                    onClick={() => toggleMarker(selectedTooth, marker.id)}
                    aria-pressed={active}
                  >
                    <ClinicalMarkerPreview
                      tooth={selectedTooth}
                      marker={marker.id}
                      color={marker.color}
                    />
                    <span>{marker.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.inspectorActions}>
            <button
              type="button"
              onClick={copyData}
              disabled={markedSurfaceCount === 0 && markedMarkerCount === 0}
            >
              {copied ? <Check size={17} /> : <Clipboard size={17} />}
              {copied ? "Đã sao chép" : "Sao chép JSON"}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadJson(
                  activeSurfaceState,
                  activeMarkerState,
                  dentition,
                )
              }
              disabled={markedSurfaceCount === 0 && markedMarkerCount === 0}
            >
              <Download size={17} />
              Tải JSON
            </button>
          </div>
        </aside>
      </div>

      <footer className={styles.footer}>
        <span>MODBL · FDI surface model</span>
        <span>Prototype · Không dùng thay thế chẩn đoán lâm sàng</span>
      </footer>
    </main>
  );
}

function Arch({
  label,
  teeth,
  selectedTooth,
  state,
  markerState,
  condition,
  onSelectTooth,
  onSetSurface,
  onClearSurface,
}: {
  label: string;
  teeth: readonly ToothId[];
  selectedTooth: ToothId;
  state: SurfaceState;
  markerState: MarkerState;
  condition: ConditionId;
  onSelectTooth: (tooth: ToothId) => void;
  onSetSurface: (tooth: ToothId, surface: SurfaceCode) => void;
  onClearSurface: (tooth: ToothId, surface: SurfaceCode) => void;
}) {
  const upper = isUpperTooth(teeth[0]);
  const primary = isPrimaryTooth(teeth[0]);

  return (
    <section className={upper ? styles.arch : `${styles.arch} ${styles.lowerArch}`}>
      <div className={styles.archLabel}>{label}</div>
      <div
        className={`${styles.teethRow} ${
          primary ? styles.teethRowPrimary : ""
        }`}
      >
        {teeth.map((tooth, index) => {
          const figure = (
            <ToothIllustration
              tooth={tooth}
              markerState={markerState}
            />
          );
          const number = (
            <button
              className={styles.toothNumber}
              type="button"
              onClick={() => onSelectTooth(tooth)}
              aria-label={`Chọn răng ${tooth}`}
            >
              {tooth}
            </button>
          );
          const surfaceMap = (
            <SurfaceMap
              tooth={tooth}
              state={state}
              condition={condition}
              disabled={isToothUnavailable(markerState, tooth)}
              onSetSurface={onSetSurface}
              onClearSurface={onClearSurface}
            />
          );

          return (
            <div
              className={`${styles.toothCell} ${
                selectedTooth === tooth ? styles.toothSelected : ""
              } ${
                index === teeth.length / 2 - 1 ? styles.beforeMidline : ""
              }`}
              key={tooth}
            >
              {upper ? (
                <>
                  {figure}
                  {number}
                  {surfaceMap}
                </>
              ) : (
                <>
                  {surfaceMap}
                  {number}
                  {figure}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ToothIllustration({
  tooth,
  markerState,
}: {
  tooth: ToothId;
  markerState: MarkerState;
}) {
  const lower = !isUpperTooth(tooth);
  const patientLeft = isPatientLeft(tooth);
  const artworkTransform = `scale(${patientLeft ? -1 : 1}, ${
    lower ? -1 : 1
  })`;
  const activeMarkers = clinicalMarkerOptions
    .filter((marker) => markerState[markerKey(tooth, marker.id)] === true)
    .map((marker) => marker.id);
  const missing = activeMarkers.includes("missing");
  const implant = activeMarkers.includes("implant");
  const nativeMarkers = activeMarkers.filter(
    (marker): marker is NativeMarkerId => nativeMarkerIds.has(marker),
  );

  return (
    <div
      className={`${styles.toothIllustration} ${
        isPrimaryTooth(tooth) ? styles.primaryToothIllustration : ""
      }`}
      data-tooth={tooth}
      role="img"
      aria-label={`${toothType(tooth)} ${tooth}${
        activeMarkers.length > 0
          ? `, ${activeMarkers
              .map((marker) => markerFor(marker)?.label)
              .join(", ")}`
          : ""
      }`}
    >
      {!missing ? (
        <img
          className={styles.toothArtwork}
          src={toothArtworkPath(tooth, implant ? "implant" : undefined)}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ transform: artworkTransform }}
        />
      ) : null}
      {!missing
        ? nativeMarkers.map((marker) => (
            <img
              className={styles.toothClinicalArtwork}
              src={toothArtworkPath(tooth, marker)}
              alt=""
              aria-hidden="true"
              draggable={false}
              key={marker}
              style={{ transform: artworkTransform }}
            />
          ))
        : null}
      {!missing && activeMarkers.includes("fracture") ? (
        <svg
          className={styles.toothInteractionOverlay}
          viewBox="0 0 70 100"
          aria-hidden="true"
        >
          <g transform={lower ? "translate(0 100) scale(1 -1)" : undefined}>
            <g
              transform={patientLeft ? "translate(70 0) scale(-1 1)" : undefined}
            >
              <path
                className={styles.markerFracture}
                d="M17 67 L28 70 L23 76 L38 73 L34 81 L52 78"
              />
            </g>
          </g>
        </svg>
      ) : null}
    </div>
  );
}

function ClinicalMarkerPreview({
  tooth,
  marker,
  color,
}: {
  tooth: ToothId;
  marker: ClinicalMarkerId;
  color: string;
}) {
  const lower = !isUpperTooth(tooth);
  const patientLeft = isPatientLeft(tooth);
  const artworkTransform = `scale(${patientLeft ? -1 : 1}, ${
    lower ? -1 : 1
  })`;

  if (marker === "missing" || marker === "fracture") {
    return (
      <span className={styles.clinicalMarkerPreview} aria-hidden="true">
        <svg viewBox="0 0 32 38">
          {marker === "missing" ? (
            <>
              <path
                className={styles.markerPreviewTooth}
                d="M8 5 C10 2 13 4 16 5 C19 4 22 2 24 5 C27 9 24 16 22 22 C20 29 19 34 16 35 C13 34 12 29 10 22 C8 16 5 9 8 5 Z"
              />
              <path
                className={styles.markerPreviewAccent}
                d="M6 7 L26 31 M26 7 L6 31"
                style={{ stroke: color }}
              />
            </>
          ) : (
            <>
              <path
                className={styles.markerPreviewTooth}
                d="M8 5 C10 2 13 4 16 5 C19 4 22 2 24 5 C27 9 24 16 22 22 C20 29 19 34 16 35 C13 34 12 29 10 22 C8 16 5 9 8 5 Z"
              />
              <path
                className={styles.markerPreviewAccent}
                d="M7 19 H13 L10 25 L21 13 L18 21 H25"
                style={{ stroke: color }}
              />
            </>
          )}
        </svg>
      </span>
    );
  }

  const variant = marker === "implant" ? "implant" : marker;

  return (
    <span className={styles.clinicalMarkerPreview} aria-hidden="true">
      {marker !== "implant" ? (
        <img
          src={toothArtworkPath(tooth)}
          alt=""
          draggable={false}
          style={{ transform: artworkTransform }}
        />
      ) : null}
      <img
        src={toothArtworkPath(tooth, variant)}
        alt=""
        draggable={false}
        style={{ transform: artworkTransform }}
      />
    </span>
  );
}

function SurfaceMap({
  tooth,
  state,
  condition,
  large = false,
  disabled = false,
  onSetSurface,
  onClearSurface,
}: {
  tooth: ToothId;
  state: SurfaceState;
  condition: ConditionId;
  large?: boolean;
  disabled?: boolean;
  onSetSurface: (tooth: ToothId, surface: SurfaceCode) => void;
  onClearSurface: (tooth: ToothId, surface: SurfaceCode) => void;
}) {
  const layout = surfaceLayout(tooth);
  const ordered = [
    { position: "top", code: layout.top, path: "M 10 10 H 90 L 68 32 H 32 Z" },
    { position: "right", code: layout.right, path: "M 90 10 V 90 L 68 68 V 32 Z" },
    { position: "bottom", code: layout.bottom, path: "M 90 90 H 10 L 32 68 H 68 Z" },
    { position: "left", code: layout.left, path: "M 10 90 V 10 L 32 32 V 68 Z" },
    { position: "center", code: layout.center, path: "M 32 32 H 68 V 68 H 32 Z" },
  ] as const;

  return (
    <svg
      className={`${styles.surfaceMap} ${large ? styles.surfaceMapLarge : ""} ${
        isAnterior(tooth) ? styles.anteriorMap : ""
      } ${disabled ? styles.surfaceMapDisabled : ""}`}
      viewBox="0 0 100 100"
      aria-label={`Răng ${tooth}, năm mặt răng`}
    >
      <rect className={styles.toothBase} x="7" y="7" width="86" height="86" rx="18" />
      {ordered.map(({ position, code, path }) => {
        const current = state[surfaceKey(tooth, code)];
        const currentCondition = conditionFor(current);
        const label = `Răng ${tooth}, mặt ${surfaceNames[code]}${
          currentCondition ? `, ${currentCondition.label}` : ""
        }`;

        return (
          <path
            className={styles.surface}
            data-position={position}
            d={path}
            fill={currentCondition?.color ?? "#ffffff"}
            key={`${position}-${code}`}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              if (disabled) return;
              if (event.shiftKey || event.altKey) {
                onClearSurface(tooth, code);
              } else {
                onSetSurface(tooth, code);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (disabled) return;
              onClearSurface(tooth, code);
            }}
            onKeyDown={(event) => {
              if (disabled) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSetSurface(tooth, code);
              }
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                onClearSurface(tooth, code);
              }
            }}
          />
        );
      })}
      {large
        ? ordered.map(({ position, code }) => (
            <text
              className={styles.surfaceLabel}
              x={position === "left" ? 20 : position === "right" ? 80 : 50}
              y={position === "top" ? 23 : position === "bottom" ? 83 : 55}
              key={`label-${position}`}
              textAnchor="middle"
            >
              {code}
            </text>
          ))
        : null}
    </svg>
  );
}
