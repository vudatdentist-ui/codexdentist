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
type AnatomyZone = "crown" | "root";
type ConditionId = (typeof conditionOptions)[number]["id"];
type ClinicalMarkerId = (typeof clinicalMarkerOptions)[number]["id"];
type SurfaceState = Record<string, ConditionId>;
type AnatomyState = Record<string, ConditionId>;
type MarkerState = Record<string, true>;
type HistoryEntry =
  | {
      target: "surface" | "anatomy";
      key: string;
      previous?: ConditionId;
    }
  | {
      target: "marker";
      key: string;
      previous: boolean;
    };

const surfaceNames: Record<SurfaceCode, string> = {
  M: "Mesial",
  D: "Distal",
  B: "Buccal",
  L: "Lingual / Palatal",
  O: "Occlusal",
  I: "Incisal",
};

const anatomyNames: Record<AnatomyZone, string> = {
  crown: "Thân răng",
  root: "Chân răng",
};

const storageKey = "codexdentist-odontogram-5-surface-v1";
const anatomyStorageKey = "codexdentist-odontogram-anatomy-v1";
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

function parseStoredAnatomyState(value: string | null): AnatomyState {
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
        const [tooth, zone] = key.split(".");
        return (
          isToothId(tooth) &&
          ["crown", "root"].includes(zone) &&
          isConditionId(condition)
        );
      }),
    ) as AnatomyState;
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

function readStoredAnatomyState() {
  try {
    return parseStoredAnatomyState(
      window.localStorage.getItem(anatomyStorageKey),
    );
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

function persistStoredState(state: SurfaceState) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The odontogram remains usable when browser storage is unavailable.
  }
}

function persistStoredAnatomyState(state: AnatomyState) {
  try {
    window.localStorage.setItem(anatomyStorageKey, JSON.stringify(state));
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

function anatomyKey(tooth: ToothId, zone: AnatomyZone) {
  return `${tooth}.${zone}`;
}

function markerKey(tooth: ToothId, marker: ClinicalMarkerId) {
  return `${tooth}.${marker}`;
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

type ToothKind = "incisor" | "canine" | "premolar" | "molar";
type ToothTemplate = "11" | "13" | "14" | "16";

function toothKind(tooth: ToothId): ToothKind {
  const position = toothPosition(tooth);

  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (isPrimaryTooth(tooth)) return "molar";
  if (position <= 5) return "premolar";
  return "molar";
}

function toothTemplate(tooth: ToothId): ToothTemplate {
  const position = toothPosition(tooth);

  if (position <= 2) return "11";
  if (position === 3) return "13";
  if (isPrimaryTooth(tooth) || position <= 5) return "14";
  return "16";
}

function toothArtworkPath(tooth: ToothId) {
  const dentition = isPrimaryTooth(tooth) ? "primary" : "adult";
  return `/odontogram-assets/${toothTemplate(tooth)}-${dentition}.svg`;
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
  anatomyState: AnatomyState,
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
  const anatomy = Object.entries(anatomyState).map(([key, condition]) => {
    const [tooth, zone] = key.split(".");
    return {
      tooth,
      dentition,
      zone,
      zoneName: anatomyNames[zone as AnatomyZone],
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

  return { notation: "FDI", dentition, surfaces, anatomy, markers };
}

function downloadJson(
  surfaceState: SurfaceState,
  anatomyState: AnatomyState,
  markerState: MarkerState,
  dentition: Dentition,
) {
  const blob = new Blob(
    [
      JSON.stringify(
        buildExportData(surfaceState, anatomyState, markerState, dentition),
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
  const [anatomyState, setAnatomyState] = useState<AnatomyState>({});
  const [markerState, setMarkerState] = useState<MarkerState>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [condition, setCondition] = useState<ConditionId>("caries");
  const [dentition, setDentition] = useState<Dentition>("adult");
  const [selectedTooth, setSelectedTooth] = useState<ToothId>("16");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSurfaceState(readStoredState());
    setAnatomyState(readStoredAnatomyState());
    setMarkerState(readStoredMarkerState());
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

  const commitAnatomyState = (
    update: (current: AnatomyState) => AnatomyState,
  ) => {
    setAnatomyState((current) => {
      const next = update(current);
      persistStoredAnatomyState(next);
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
  const activeAnatomyState = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(anatomyState).filter(([key]) =>
          activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as AnatomyState,
    [activeToothSet, anatomyState],
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
  const markedAnatomyCount = Object.keys(activeAnatomyState).length;
  const markedMarkerCount = Object.keys(activeMarkerState).length;
  const markedToothCount = new Set(
    [
      ...Object.keys(activeSurfaceState),
      ...Object.keys(activeAnatomyState),
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
  const selectedAnatomyRows = useMemo(
    () =>
      (["crown", "root"] as const).map((zone) => ({
        zone,
        condition: anatomyState[anatomyKey(selectedTooth, zone)],
      })),
    [anatomyState, selectedTooth],
  );

  const setSurface = (tooth: ToothId, surface: SurfaceCode) => {
    const key = surfaceKey(tooth, surface);
    const previous = surfaceState[key];

    if (previous === condition) {
      return;
    }

    setSelectedTooth(tooth);
    setHistory((current) => [
      ...current,
      { target: "surface", key, previous },
    ]);
    commitSurfaceState((current) => ({ ...current, [key]: condition }));
  };

  const clearSurface = (tooth: ToothId, surface: SurfaceCode) => {
    const key = surfaceKey(tooth, surface);
    const previous = surfaceState[key];

    if (!previous) {
      return;
    }

    setHistory((current) => [
      ...current,
      { target: "surface", key, previous },
    ]);
    commitSurfaceState((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const setAnatomy = (tooth: ToothId, zone: AnatomyZone) => {
    const key = anatomyKey(tooth, zone);
    const previous = anatomyState[key];

    if (previous === condition) {
      return;
    }

    setSelectedTooth(tooth);
    setHistory((current) => [
      ...current,
      { target: "anatomy", key, previous },
    ]);
    commitAnatomyState((current) => ({ ...current, [key]: condition }));
  };

  const clearAnatomy = (tooth: ToothId, zone: AnatomyZone) => {
    const key = anatomyKey(tooth, zone);
    const previous = anatomyState[key];

    if (!previous) {
      return;
    }

    setSelectedTooth(tooth);
    setHistory((current) => [
      ...current,
      { target: "anatomy", key, previous },
    ]);
    commitAnatomyState((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const toggleMarker = (tooth: ToothId, marker: ClinicalMarkerId) => {
    const key = markerKey(tooth, marker);
    const previous = markerState[key] === true;

    setSelectedTooth(tooth);
    setHistory((current) => [
      ...current,
      { target: "marker", key, previous },
    ]);
    commitMarkerState((current) => {
      const next = { ...current };
      if (previous) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });
  };

  const undo = () => {
    const last = history.at(-1);
    if (!last) return;

    if (last.target === "marker") {
      commitMarkerState((current) => {
        const next = { ...current };
        if (last.previous) {
          next[last.key] = true;
        } else {
          delete next[last.key];
        }
        return next;
      });
      setHistory((current) => current.slice(0, -1));
      return;
    }

    const restore = (current: Record<string, ConditionId>) => {
      const next = { ...current };
      if (last.previous) {
        next[last.key] = last.previous;
      } else {
        delete next[last.key];
      }
      return next;
    };

    if (last.target === "surface") {
      commitSurfaceState(restore);
    } else {
      commitAnatomyState(restore);
    }
    setHistory((current) => current.slice(0, -1));
  };

  const reset = () => {
    const label = dentition === "adult" ? "răng vĩnh viễn" : "răng sữa";
    if (
      (markedSurfaceCount === 0 &&
        markedAnatomyCount === 0 &&
        markedMarkerCount === 0) ||
      !window.confirm(`Xóa toàn bộ đánh dấu của bộ ${label}?`)
    ) {
      return;
    }
    commitSurfaceState((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as SurfaceState,
    );
    commitAnatomyState((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as AnatomyState,
    );
    commitMarkerState((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !activeToothSet.has(key.split(".")[0] as ToothId),
        ),
      ) as MarkerState,
    );
    setHistory([]);
  };

  const copyData = async () => {
    const payload = JSON.stringify(
      buildExportData(
        activeSurfaceState,
        activeAnatomyState,
        activeMarkerState,
        dentition,
      ),
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
            disabled={
              markedSurfaceCount === 0 &&
              markedAnatomyCount === 0 &&
              markedMarkerCount === 0
            }
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
          <span><strong>{markedAnatomyCount}</strong> vùng</span>
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
            anatomyState={anatomyState}
            markerState={markerState}
            condition={condition}
            onSelectTooth={setSelectedTooth}
            onSetSurface={setSurface}
            onClearSurface={clearSurface}
            onSetAnatomy={setAnatomy}
            onClearAnatomy={clearAnatomy}
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
            anatomyState={anatomyState}
            markerState={markerState}
            condition={condition}
            onSelectTooth={setSelectedTooth}
            onSetSurface={setSurface}
            onClearSurface={clearSurface}
            onSetAnatomy={setAnatomy}
            onClearAnatomy={clearAnatomy}
          />
        </section>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHeading}>
            <div>
              <span>Răng đang chọn</span>
              <h2>R{selectedTooth}</h2>
            </div>
            <strong>{toothType(selectedTooth)}</strong>
          </div>

          <div className={styles.focusTooth}>
            <SurfaceMap
              tooth={selectedTooth}
              state={surfaceState}
              condition={condition}
              large
              onSetSurface={setSurface}
              onClearSurface={clearSurface}
            />
          </div>

          <div className={styles.surfaceList}>
            {selectedRows.map(({ surface, condition: surfaceCondition }) => (
              <button
                key={surface}
                type="button"
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

          <div className={styles.anatomyList}>
            {selectedAnatomyRows.map(({ zone, condition: zoneCondition }) => (
              <button
                key={zone}
                type="button"
                onClick={() => setAnatomy(selectedTooth, zone)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  clearAnatomy(selectedTooth, zone);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    clearAnatomy(selectedTooth, zone);
                  }
                }}
                aria-label={`${anatomyNames[zone]} răng ${selectedTooth}`}
              >
                <span className={styles.anatomyIcon} aria-hidden="true">
                  {zone === "crown" ? "T" : "C"}
                </span>
                <span>
                  <strong>{anatomyNames[zone]}</strong>
                  <small>
                    {conditionFor(zoneCondition)?.label ?? "Chưa đánh dấu"}
                  </small>
                </span>
                {zoneCondition ? (
                  <i style={{ backgroundColor: conditionFor(zoneCondition)?.color }} />
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
                    <ClinicalMarkerIcon marker={marker.id} color={marker.color} />
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
              disabled={
                markedSurfaceCount === 0 &&
                markedAnatomyCount === 0 &&
                markedMarkerCount === 0
              }
            >
              {copied ? <Check size={17} /> : <Clipboard size={17} />}
              {copied ? "Đã sao chép" : "Sao chép JSON"}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadJson(
                  activeSurfaceState,
                  activeAnatomyState,
                  activeMarkerState,
                  dentition,
                )
              }
              disabled={
                markedSurfaceCount === 0 &&
                markedAnatomyCount === 0 &&
                markedMarkerCount === 0
              }
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
  anatomyState,
  markerState,
  condition,
  onSelectTooth,
  onSetSurface,
  onClearSurface,
  onSetAnatomy,
  onClearAnatomy,
}: {
  label: string;
  teeth: readonly ToothId[];
  selectedTooth: ToothId;
  state: SurfaceState;
  anatomyState: AnatomyState;
  markerState: MarkerState;
  condition: ConditionId;
  onSelectTooth: (tooth: ToothId) => void;
  onSetSurface: (tooth: ToothId, surface: SurfaceCode) => void;
  onClearSurface: (tooth: ToothId, surface: SurfaceCode) => void;
  onSetAnatomy: (tooth: ToothId, zone: AnatomyZone) => void;
  onClearAnatomy: (tooth: ToothId, zone: AnatomyZone) => void;
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
              state={anatomyState}
              markerState={markerState}
              condition={condition}
              onSetAnatomy={onSetAnatomy}
              onClearAnatomy={onClearAnatomy}
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

const anatomyPaths: Record<
  ToothKind,
  { crown: string; root: string; details: string[] }
> = {
  incisor: {
    root:
      "M27 61 C27 48 28 28 32 9 C33 4 37 4 39 9 C43 28 44 48 43 61 Z",
    crown:
      "M24 58 C27 55 43 55 46 58 L47 79 C46 87 41 91 35 91 C29 91 24 87 23 79 Z",
    details: ["M28 63 C31 66 39 66 43 63"],
  },
  canine: {
    root:
      "M27 62 C27 47 29 24 34 5 C35 2 38 2 39 6 C43 28 43 48 42 62 Z",
    crown:
      "M25 59 C29 56 40 55 44 59 L47 76 C44 80 40 87 35 92 C30 87 26 81 23 76 Z",
    details: ["M28 63 C31 66 39 66 42 63"],
  },
  premolar: {
    root:
      "M22 61 C22 48 19 24 23 9 C24 5 28 5 30 10 L35 40 L40 10 C42 5 46 5 47 10 C50 26 47 48 47 61 Z",
    crown:
      "M19 59 C21 54 28 54 35 58 C42 54 49 54 51 59 L53 76 C50 85 44 90 35 90 C26 90 20 85 17 76 Z",
    details: ["M22 64 C28 68 42 68 48 64", "M35 59 V83"],
  },
  molar: {
    root:
      "M13 61 C14 47 11 24 16 10 C17 6 22 6 24 11 L29 40 L33 9 C34 5 38 5 40 10 L43 41 L48 12 C50 7 55 8 56 13 C59 28 55 49 56 61 Z",
    crown:
      "M10 59 C13 53 21 53 27 57 C32 53 38 53 43 57 C49 53 57 54 60 60 L62 76 C59 85 50 90 35 90 C20 90 11 85 8 76 Z",
    details: [
      "M14 64 C23 69 47 69 56 64",
      "M23 59 C25 66 24 78 22 84",
      "M46 59 C44 66 45 78 48 84",
    ],
  },
};

function ToothIllustration({
  tooth,
  state,
  markerState,
  condition,
  onSetAnatomy,
  onClearAnatomy,
}: {
  tooth: ToothId;
  state: AnatomyState;
  markerState: MarkerState;
  condition: ConditionId;
  onSetAnatomy: (tooth: ToothId, zone: AnatomyZone) => void;
  onClearAnatomy: (tooth: ToothId, zone: AnatomyZone) => void;
}) {
  const anatomy = anatomyPaths[toothKind(tooth)];
  const lower = !isUpperTooth(tooth);
  const patientLeft = isPatientLeft(tooth);
  const artworkTransform = `scale(${patientLeft ? -1 : 1}, ${
    lower ? -1 : 1
  })`;
  const activeMarkers = clinicalMarkerOptions
    .filter((marker) => markerState[markerKey(tooth, marker.id)] === true)
    .map((marker) => marker.id);
  const zones = (["root", "crown"] as const).map((zone) => {
    const current = state[anatomyKey(tooth, zone)];
    return {
      zone,
      current,
      currentCondition: conditionFor(current),
      patternId: `anatomy-${tooth}-${zone}-${current ?? "empty"}`,
    };
  });

  const interactivePath = (
    zone: AnatomyZone,
    path: string,
    baseFill: string,
  ) => {
    const zoneState = zones.find((item) => item.zone === zone);
    const currentCondition = zoneState?.currentCondition;
    const label = `Răng ${tooth}, ${anatomyNames[zone]}${
      currentCondition ? `, ${currentCondition.label}` : ""
    }`;

    return (
      <path
        className={`${styles.anatomyZone} ${
          zone === "root" ? styles.toothRoot : styles.toothCrown
        } ${currentCondition ? styles.anatomyZoneMarked : ""}`}
        data-anatomy-zone={zone}
        d={path}
        fill={
          currentCondition && zoneState
            ? `url(#${zoneState.patternId})`
            : baseFill
        }
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          if (event.shiftKey || event.altKey) {
            onClearAnatomy(tooth, zone);
          } else {
            onSetAnatomy(tooth, zone);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onClearAnatomy(tooth, zone);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSetAnatomy(tooth, zone);
          }
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            onClearAnatomy(tooth, zone);
          }
        }}
      />
    );
  };

  return (
    <div
      className={`${styles.toothIllustration} ${
        isPrimaryTooth(tooth) ? styles.primaryToothIllustration : ""
      }`}
      data-tooth={tooth}
      role="group"
      aria-label={`${toothType(tooth)} ${tooth}, đánh dấu thân và chân răng${
        activeMarkers.length > 0
          ? `, ${activeMarkers
              .map((marker) => markerFor(marker)?.label)
              .join(", ")}`
          : ""
      }`}
    >
      <img
        className={styles.toothArtwork}
        src={toothArtworkPath(tooth)}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{ transform: artworkTransform }}
      />
      <svg
        className={styles.toothInteractionOverlay}
        viewBox="0 0 70 100"
        role="group"
        aria-label={`Vùng giải phẫu răng ${tooth}`}
      >
        <defs>
          {zones.map(({ zone, currentCondition, patternId }) =>
            currentCondition ? (
              <pattern
                id={patternId}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(28)"
                key={zone}
              >
                <rect width="5" height="5" fill={`${currentCondition.color}20`} />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="5"
                  stroke={currentCondition.color}
                  strokeWidth="2"
                />
              </pattern>
            ) : null,
          )}
        </defs>
        <g transform={lower ? "translate(0 100) scale(1 -1)" : undefined}>
          <g transform={patientLeft ? "translate(70 0) scale(-1 1)" : undefined}>
            {interactivePath("root", anatomy.root, "transparent")}
            {interactivePath("crown", anatomy.crown, "transparent")}
            <ClinicalMarkerOverlay
              tooth={tooth}
              anatomy={anatomy}
              markers={activeMarkers}
            />
          </g>
        </g>
      </svg>
    </div>
  );
}

function ClinicalMarkerOverlay({
  tooth,
  anatomy,
  markers,
}: {
  tooth: ToothId;
  anatomy: (typeof anatomyPaths)[ToothKind];
  markers: ClinicalMarkerId[];
}) {
  if (markers.length === 0) {
    return null;
  }

  const has = (marker: ClinicalMarkerId) => markers.includes(marker);
  const crownPatternId = `clinical-crown-${tooth}`;

  return (
    <g className={styles.clinicalMarkerOverlay} aria-hidden="true">
      {has("crown") ? (
        <>
          <defs>
            <pattern
              id={crownPatternId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(30)"
            >
              <rect width="5" height="5" fill="#d18a1220" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="5"
                stroke="#d18a12"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          <path
            className={styles.markerCrown}
            d={anatomy.crown}
            fill={`url(#${crownPatternId})`}
          />
        </>
      ) : null}

      {has("implant") ? (
        <g className={styles.markerImplant}>
          <path d="M27 16 L30 57 H40 L43 16 Z" />
          {[22, 29, 36, 43, 50].map((y) => (
            <path d={`M28 ${y} H42`} key={y} />
          ))}
          <path d="M31 57 H39 V65 H31 Z" />
        </g>
      ) : null}

      {has("rootCanal") ? (
        <g className={styles.markerRootCanal}>
          <path d="M32 13 C31 30 32 48 33 66" />
          <path d="M38 13 C39 30 38 48 37 66" />
        </g>
      ) : null}

      {has("pulpitis") ? (
        <g className={styles.markerPulpitis}>
          <path d="M35 13 C34 31 35 48 35 64" />
          <circle cx="35" cy="70" r="5" />
        </g>
      ) : null}

      {has("periodontitis") ? (
        <path
          className={styles.markerPeriodontitis}
          d="M4 57 C10 51 16 63 22 57 C28 51 34 63 40 57 C46 51 52 63 58 57 C62 54 65 54 68 57"
        />
      ) : null}

      {has("periapical") ? (
        <g className={styles.markerPeriapical}>
          <circle cx="35" cy="11" r="8" />
          <circle cx="35" cy="11" r="3" />
        </g>
      ) : null}

      {has("fracture") ? (
        <path
          className={styles.markerFracture}
          d="M17 67 L28 70 L23 76 L38 73 L34 81 L52 78"
        />
      ) : null}

      {has("missing") ? (
        <g className={styles.markerMissing}>
          <path d="M12 10 L58 90" />
          <path d="M58 10 L12 90" />
        </g>
      ) : null}

      {has("extraction") ? (
        <g className={styles.markerExtraction}>
          <path d="M18 18 L52 84" />
          <path d="M52 18 L18 84" />
        </g>
      ) : null}
    </g>
  );
}

function ClinicalMarkerIcon({
  marker,
  color,
}: {
  marker: ClinicalMarkerId;
  color: string;
}) {
  if (marker === "implant") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3 H16 L15 18 H9 Z M8.5 7 H15.5 M9 11 H15 M9 15 H15" />
      </svg>
    );
  }

  if (marker === "pulpitis" || marker === "rootCanal") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4 C9 8 9 18 12 21 C15 18 15 8 16 4" />
        <path d="M12 5 V17" style={{ stroke: color }} />
      </svg>
    );
  }

  if (marker === "periodontitis") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7 C7 3 9 11 12 7 C15 3 17 11 20 7" style={{ stroke: color }} />
        <path d="M8 8 C9 12 9 18 12 21 C15 18 15 12 16 8" />
      </svg>
    );
  }

  if (marker === "periapical") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3 C9 10 10 15 12 17 C14 15 15 10 15 3" />
        <circle cx="12" cy="19" r="3" style={{ stroke: color }} />
      </svg>
    );
  }

  if (marker === "crown") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5 L8 9 L12 4 L16 9 L19 5 L18 18 H6 Z" style={{ stroke: color }} />
      </svg>
    );
  }

  if (marker === "fracture") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12 H10 L8 17 L16 9 L14 14 H20" style={{ stroke: color }} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5 L18 19 M18 5 L6 19" style={{ stroke: color }} />
    </svg>
  );
}

function SurfaceMap({
  tooth,
  state,
  condition,
  large = false,
  onSetSurface,
  onClearSurface,
}: {
  tooth: ToothId;
  state: SurfaceState;
  condition: ConditionId;
  large?: boolean;
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
      }`}
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
            tabIndex={0}
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              if (event.shiftKey || event.altKey) {
                onClearSurface(tooth, code);
              } else {
                onSetSurface(tooth, code);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onClearSurface(tooth, code);
            }}
            onKeyDown={(event) => {
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
