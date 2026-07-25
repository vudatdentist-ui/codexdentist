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

const upperTeeth = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
] as const;

const lowerTeeth = [
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38",
] as const;

const conditionOptions = [
  { id: "caries", label: "Sâu răng", shortLabel: "Sâu", color: "#d64045" },
  { id: "existing", label: "Phục hồi hiện có", shortLabel: "Hiện có", color: "#2878b5" },
  { id: "planned", label: "Điều trị dự kiến", shortLabel: "Dự kiến", color: "#d18a12" },
  { id: "watch", label: "Theo dõi", shortLabel: "Theo dõi", color: "#14866d" },
] as const;

type ToothId = (typeof upperTeeth)[number] | (typeof lowerTeeth)[number];
type SurfaceCode = "M" | "D" | "B" | "L" | "O" | "I";
type ConditionId = (typeof conditionOptions)[number]["id"];
type SurfaceState = Record<string, ConditionId>;
type HistoryEntry = {
  key: string;
  previous?: ConditionId;
  next?: ConditionId;
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

function isToothId(value: string): value is ToothId {
  return [...upperTeeth, ...lowerTeeth].includes(value as ToothId);
}

function isConditionId(value: unknown): value is ConditionId {
  return conditionOptions.some((condition) => condition.id === value);
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

function readStoredState() {
  try {
    return parseStoredState(window.localStorage.getItem(storageKey));
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

function surfaceKey(tooth: ToothId, surface: SurfaceCode) {
  return `${tooth}.${surface}`;
}

function toothPosition(tooth: ToothId) {
  return Number(tooth[1]);
}

function isAnterior(tooth: ToothId) {
  return toothPosition(tooth) <= 3;
}

function toothType(tooth: ToothId) {
  const position = toothPosition(tooth);

  if (position <= 2) return "Răng cửa";
  if (position === 3) return "Răng nanh";
  if (position <= 5) return "Răng hàm nhỏ";
  return "Răng hàm lớn";
}

function toothSurfaces(tooth: ToothId): SurfaceCode[] {
  return ["M", "D", "B", "L", isAnterior(tooth) ? "I" : "O"];
}

function surfaceLayout(tooth: ToothId) {
  const quadrant = Number(tooth[0]);
  const upper = quadrant <= 2;
  const rightQuadrant = quadrant === 1 || quadrant === 4;

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

function downloadJson(state: SurfaceState) {
  const rows = Object.entries(state).map(([key, condition]) => {
    const [tooth, surface] = key.split(".");
    return {
      tooth,
      surface,
      surfaceName: surfaceNames[surface as SurfaceCode],
      condition,
      conditionName: conditionFor(condition)?.label ?? condition,
    };
  });
  const blob = new Blob([JSON.stringify({ notation: "FDI", surfaces: rows }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "codexdentist-odontogram.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OdontogramSurfaceLab() {
  const [surfaceState, setSurfaceState] = useState<SurfaceState>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [condition, setCondition] = useState<ConditionId>("caries");
  const [selectedTooth, setSelectedTooth] = useState<ToothId>("16");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSurfaceState(readStoredState());
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

  const markedSurfaceCount = Object.keys(surfaceState).length;
  const markedToothCount = new Set(
    Object.keys(surfaceState).map((key) => key.split(".")[0]),
  ).size;

  const selectedRows = useMemo(
    () =>
      toothSurfaces(selectedTooth).map((surface) => ({
        surface,
        condition: surfaceState[surfaceKey(selectedTooth, surface)],
      })),
    [selectedTooth, surfaceState],
  );

  const setSurface = (tooth: ToothId, surface: SurfaceCode) => {
    const key = surfaceKey(tooth, surface);
    const previous = surfaceState[key];

    if (previous === condition) {
      return;
    }

    setSelectedTooth(tooth);
    setHistory((current) => [...current, { key, previous, next: condition }]);
    commitSurfaceState((current) => ({ ...current, [key]: condition }));
  };

  const clearSurface = (tooth: ToothId, surface: SurfaceCode) => {
    const key = surfaceKey(tooth, surface);
    const previous = surfaceState[key];

    if (!previous) {
      return;
    }

    setHistory((current) => [...current, { key, previous }]);
    commitSurfaceState((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const undo = () => {
    const last = history.at(-1);
    if (!last) return;

    commitSurfaceState((current) => {
      const next = { ...current };
      if (last.previous) {
        next[last.key] = last.previous;
      } else {
        delete next[last.key];
      }
      return next;
    });
    setHistory((current) => current.slice(0, -1));
  };

  const reset = () => {
    if (markedSurfaceCount === 0 || !window.confirm("Xóa toàn bộ đánh dấu trên odontogram?")) {
      return;
    }
    commitSurfaceState(() => ({}));
    setHistory([]);
  };

  const copyData = async () => {
    const payload = JSON.stringify(
      {
        notation: "FDI",
        surfaces: Object.entries(surfaceState).map(([key, value]) => {
          const [tooth, surface] = key.split(".");
          return { tooth, surface, condition: value };
        }),
      },
      null,
      2,
    );
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
            <p>FDI · Răng vĩnh viễn</p>
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
            disabled={markedSurfaceCount === 0}
            aria-label="Xóa toàn bộ"
            title="Xóa toàn bộ"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section className={styles.toolbar} aria-label="Trạng thái bề mặt">
        <div className={styles.conditionControl}>
          {conditionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={condition === option.id ? styles.conditionActive : undefined}
              onClick={() => setCondition(option.id)}
              aria-pressed={condition === option.id}
            >
              <span style={{ backgroundColor: option.color }} />
              <span className={styles.fullLabel}>{option.label}</span>
              <span className={styles.shortLabel}>{option.shortLabel}</span>
            </button>
          ))}
        </div>
        <div className={styles.toolbarStats}>
          <span><strong>{markedToothCount}</strong> răng</span>
          <span><strong>{markedSurfaceCount}</strong> mặt</span>
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

          <div className={styles.inspectorActions}>
            <button type="button" onClick={copyData} disabled={markedSurfaceCount === 0}>
              {copied ? <Check size={17} /> : <Clipboard size={17} />}
              {copied ? "Đã sao chép" : "Sao chép JSON"}
            </button>
            <button
              type="button"
              onClick={() => downloadJson(surfaceState)}
              disabled={markedSurfaceCount === 0}
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
  condition,
  onSelectTooth,
  onSetSurface,
  onClearSurface,
}: {
  label: string;
  teeth: readonly ToothId[];
  selectedTooth: ToothId;
  state: SurfaceState;
  condition: ConditionId;
  onSelectTooth: (tooth: ToothId) => void;
  onSetSurface: (tooth: ToothId, surface: SurfaceCode) => void;
  onClearSurface: (tooth: ToothId, surface: SurfaceCode) => void;
}) {
  return (
    <section className={styles.arch}>
      <div className={styles.archLabel}>{label}</div>
      <div className={styles.teethRow}>
        {teeth.map((tooth, index) => (
          <div
            className={`${styles.toothCell} ${
              selectedTooth === tooth ? styles.toothSelected : ""
            } ${index === 7 ? styles.beforeMidline : ""}`}
            key={tooth}
          >
            <button
              className={styles.toothNumber}
              type="button"
              onClick={() => onSelectTooth(tooth)}
              aria-label={`Chọn răng ${tooth}`}
            >
              {tooth}
            </button>
            <SurfaceMap
              tooth={tooth}
              state={state}
              condition={condition}
              onSetSurface={onSetSurface}
              onClearSurface={onClearSurface}
            />
          </div>
        ))}
      </div>
    </section>
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
