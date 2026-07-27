import type {
  GeneralAssessmentState,
  OdontogramData,
  OdontogramEntry,
  OdontogramEntryKind,
  OdontogramEntryStatus,
} from "codexdentist-odontogram";

const MAX_SNAPSHOT_BYTES = 64 * 1024;

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
const arches = [
  adultUpperTeeth,
  adultLowerTeeth,
  primaryUpperTeeth,
  primaryLowerTeeth,
] as const;
const allTeeth = new Set(arches.flat());
const conditionIds = new Set([
  "caries",
  "existing",
  "inlayOnlay",
  "planned",
  "watch",
]);
const entryKinds = new Set<OdontogramEntryKind>([
  "condition",
  "restoration",
  "procedure",
  "prosthesis",
]);
const entryStatuses = new Set<OdontogramEntryStatus>([
  "observed",
  "existing",
  "planned",
  "monitoring",
]);
const markerIds = new Set([
  "caries",
  "pulpitis",
  "periodontitis",
  "boneLoss",
  "periapical",
  "implant",
  "rootCanal",
  "crown",
  "missing",
  "extraction",
  "fracture",
]);
const quickDiagnosisOptions = {
  both: {
    gingiva: ["healthy", "localized", "generalized"],
    calculus: ["none", "light", "moderate", "heavy"],
    plaque: ["low", "moderate", "high"],
    "oral-hygiene": ["good", "fair", "poor"],
    angle: ["class-i", "class-ii-1", "class-ii-2", "class-iii"],
    overjet: ["normal", "increased", "reverse"],
    overbite: ["normal", "deep", "open"],
    crossbite: ["present"],
    midline: ["deviated"],
  },
  upper: {
    crowding: ["mild", "moderate", "severe"],
    spacing: ["mild", "moderate", "severe"],
    narrow: ["present"],
    asymmetry: ["present"],
  },
  lower: {
    crowding: ["mild", "moderate", "severe"],
    spacing: ["mild", "moderate", "severe"],
    narrow: ["present"],
    asymmetry: ["present"],
  },
} as const;

export const emptyOdontogramData: OdontogramData = {
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

export class OdontogramValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdontogramValidationError";
  }
}

export function normalizeOdontogramData(value: unknown): OdontogramData {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) {
    throw new OdontogramValidationError("Invalid odontogram version.");
  }

  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new OdontogramValidationError("Odontogram snapshot is too large.");
  }

  if (value.version === 1) {
    return migrateLegacyOdontogram(value);
  }

  return {
    version: 2,
    entries: normalizeEntries(value.entries),
    generalAssessment: normalizeGeneralAssessment(value.generalAssessment),
  };
}

function migrateLegacyOdontogram(
  value: Record<string, unknown>,
): OdontogramData {
  const surfaceState = normalizeSurfaceState(value.surfaceState);
  const anatomyState = normalizeAnatomyState(value.anatomyState);
  const markerState = normalizeMarkerState(value.markerState);
  const bridges = normalizeBridges(value.bridges);
  const entries: OdontogramEntry[] = [];

  for (const [key, condition] of Object.entries(surfaceState)) {
    const [tooth, surface] = key.split(".");
    entries.push({
      id: `surface:${tooth}:${surface}`,
      conceptId: conditionConcept(condition),
      kind: conditionKind(condition),
      status: conditionStatus(condition),
      target: {
        scope: "surface",
        teeth: [tooth],
        surface: surface as OdontogramEntry["target"]["surface"],
        dentition: dentitionForTooth(tooth),
      },
      attributes: { conditionId: condition },
    });
  }

  for (const [key, condition] of Object.entries(anatomyState)) {
    const [tooth, region] = key.split(".");
    entries.push({
      id: `region:${tooth}:${region}:condition`,
      conceptId: conditionConcept(condition),
      kind: conditionKind(condition),
      status: conditionStatus(condition),
      target: {
        scope: "region",
        teeth: [tooth],
        region: region as "crown" | "root",
        dentition: dentitionForTooth(tooth),
      },
      attributes: { conditionId: condition },
    });
  }

  for (const key of Object.keys(markerState)) {
    const [tooth, marker] = key.split(".");
    const target = defaultMarkerTarget(marker);
    entries.push({
      id: `marker:${tooth}:${marker}`,
      conceptId: `marker.${marker}`,
      kind: markerKind(marker),
      status: markerStatus(marker),
      target: {
        scope: target === "tooth" ? "tooth" : "region",
        teeth: [tooth],
        ...(target === "tooth" ? {} : { region: target }),
        dentition: dentitionForTooth(tooth),
      },
      attributes: { markerId: marker },
    });
  }

  for (const bridge of bridges) {
    entries.push({
      id: `bridge:${bridge.id}`,
      conceptId: "bridge",
      kind: "prosthesis",
      status: "existing",
      target: {
        scope: "span",
        teeth: [...bridge.teeth],
        dentition: bridge.dentition,
      },
    });
  }

  return {
    version: 2,
    entries,
    generalAssessment: normalizeGeneralAssessment(value.quickDiagnosis),
  };
}

function normalizeEntries(value: unknown): OdontogramEntry[] {
  if (!Array.isArray(value) || value.length > 900) {
    throw new OdontogramValidationError("Invalid odontogram entries.");
  }

  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new OdontogramValidationError("Invalid odontogram entry.");
    }

    const { id, conceptId, kind, status } = candidate;
    if (
      typeof id !== "string" ||
      id.length < 1 ||
      id.length > 160 ||
      ids.has(id) ||
      typeof conceptId !== "string" ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(conceptId) ||
      typeof kind !== "string" ||
      !entryKinds.has(kind as OdontogramEntryKind) ||
      typeof status !== "string" ||
      !entryStatuses.has(status as OdontogramEntryStatus)
    ) {
      throw new OdontogramValidationError("Invalid odontogram entry fields.");
    }
    ids.add(id);

    const target = normalizeEntryTarget(candidate.target);
    const attributes = normalizeEntryAttributes(candidate.attributes);

    return {
      id,
      conceptId,
      kind: kind as OdontogramEntryKind,
      status: status as OdontogramEntryStatus,
      target,
      ...(attributes ? { attributes } : {}),
    };
  });
}

function normalizeEntryTarget(value: unknown): OdontogramEntry["target"] {
  if (!isRecord(value) || !Array.isArray(value.teeth)) {
    throw new OdontogramValidationError("Invalid odontogram target.");
  }
  const teeth = value.teeth.filter(
    (tooth): tooth is string => typeof tooth === "string" && isTooth(tooth),
  );
  if (teeth.length !== value.teeth.length || new Set(teeth).size !== teeth.length) {
    throw new OdontogramValidationError("Invalid odontogram target teeth.");
  }

  const scope = value.scope;
  if (!["tooth", "surface", "region", "span"].includes(String(scope))) {
    throw new OdontogramValidationError("Invalid odontogram target scope.");
  }
  if (scope !== "span" && teeth.length !== 1) {
    throw new OdontogramValidationError("A target requires exactly one tooth.");
  }
  if (scope === "span" && teeth.length < 2) {
    throw new OdontogramValidationError("A span requires at least two teeth.");
  }

  const tooth = teeth[0];
  const dentition = value.dentition;
  if (
    dentition !== undefined &&
    dentition !== "adult" &&
    dentition !== "primary"
  ) {
    throw new OdontogramValidationError("Invalid odontogram dentition.");
  }
  if (
    dentition &&
    teeth.some((item) => dentitionForTooth(item) !== dentition)
  ) {
    throw new OdontogramValidationError("Target dentition does not match teeth.");
  }

  if (
    scope === "surface" &&
    (typeof value.surface !== "string" ||
      !isSurfaceForTooth(tooth, value.surface))
  ) {
    throw new OdontogramValidationError("Invalid odontogram target surface.");
  }
  if (
    scope === "region" &&
    value.region !== "crown" &&
    value.region !== "root"
  ) {
    throw new OdontogramValidationError("Invalid odontogram target region.");
  }
  if (scope === "span") {
    assertContiguousSpan(teeth);
  }

  return {
    scope: scope as OdontogramEntry["target"]["scope"],
    teeth,
    ...(scope === "surface"
      ? { surface: value.surface as OdontogramEntry["target"]["surface"] }
      : {}),
    ...(scope === "region"
      ? { region: value.region as "crown" | "root" }
      : {}),
    ...(dentition ? { dentition } : {}),
  };
}

function normalizeEntryAttributes(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || Object.keys(value).length > 12) {
    throw new OdontogramValidationError("Invalid odontogram attributes.");
  }

  const result: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !/^[A-Za-z0-9._-]{1,48}$/.test(key) ||
      !["string", "number", "boolean"].includes(typeof entry) ||
      (typeof entry === "string" && entry.length > 500) ||
      (typeof entry === "number" && !Number.isFinite(entry))
    ) {
      throw new OdontogramValidationError("Invalid odontogram attribute.");
    }
    result[key] = entry as string | number | boolean;
  }
  return result;
}

function normalizeSurfaceState(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 260) {
    throw new OdontogramValidationError("Invalid odontogram surfaces.");
  }

  const result: Record<
    string,
    "caries" | "existing" | "inlayOnlay" | "planned" | "watch"
  > = {};

  for (const [key, condition] of Object.entries(value)) {
    const [tooth, surface, extra] = key.split(".");
    if (
      extra !== undefined ||
      !isTooth(tooth) ||
      !isSurfaceForTooth(tooth, surface) ||
      typeof condition !== "string" ||
      !conditionIds.has(condition)
    ) {
      throw new OdontogramValidationError("Invalid odontogram surface entry.");
    }
    result[key] = condition as
      | "caries"
      | "existing"
      | "inlayOnlay"
      | "planned"
      | "watch";
  }

  return result;
}

function normalizeAnatomyState(value: unknown) {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value) || Object.keys(value).length > 104) {
    throw new OdontogramValidationError("Invalid odontogram anatomy.");
  }

  const result: Record<
    string,
    "caries" | "existing" | "inlayOnlay" | "planned" | "watch"
  > = {};

  for (const [key, condition] of Object.entries(value)) {
    const [tooth, zone, extra] = key.split(".");
    if (
      extra !== undefined ||
      !isTooth(tooth) ||
      (zone !== "crown" && zone !== "root") ||
      typeof condition !== "string" ||
      !conditionIds.has(condition)
    ) {
      throw new OdontogramValidationError("Invalid odontogram anatomy entry.");
    }
    result[key] = condition as
      | "caries"
      | "existing"
      | "inlayOnlay"
      | "planned"
      | "watch";
  }

  return result;
}

function normalizeMarkerState(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 520) {
    throw new OdontogramValidationError("Invalid odontogram markers.");
  }

  const result: Record<string, true> = {};

  for (const [key, enabled] of Object.entries(value)) {
    const [tooth, marker, extra] = key.split(".");
    if (
      extra !== undefined ||
      !isTooth(tooth) ||
      !markerIds.has(marker) ||
      enabled !== true
    ) {
      throw new OdontogramValidationError("Invalid odontogram marker entry.");
    }
    result[key] = true;
  }

  return result;
}

function normalizeBridges(value: unknown) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new OdontogramValidationError("Invalid odontogram bridges.");
  }

  const seen = new Set<string>();

  return value.map((bridge) => {
    if (
      !isRecord(bridge) ||
      (bridge.dentition !== "adult" && bridge.dentition !== "primary") ||
      !Array.isArray(bridge.teeth)
    ) {
      throw new OdontogramValidationError("Invalid odontogram bridge.");
    }
    const dentition = bridge.dentition as "adult" | "primary";

    const teeth = bridge.teeth.filter(
      (tooth): tooth is string => typeof tooth === "string" && isTooth(tooth),
    );
    if (teeth.length !== bridge.teeth.length || teeth.length < 2) {
      throw new OdontogramValidationError("A bridge requires valid teeth.");
    }

    const arch = arches.find((candidate) => candidate.includes(teeth[0] as never));
    const expectedDentition = Number(teeth[0][0]) > 4 ? "primary" : "adult";
    if (!arch || dentition !== expectedDentition) {
      throw new OdontogramValidationError("Bridge teeth must share a dentition.");
    }

    const uniqueTeeth = [...new Set(teeth)];
    const indexes = uniqueTeeth
      .map((tooth) => arch.indexOf(tooth as never))
      .sort((left, right) => left - right);
    const contiguous = indexes.every(
      (index, position) =>
        index >= 0 && (position === 0 || index === indexes[position - 1] + 1),
    );
    if (uniqueTeeth.length !== teeth.length || !contiguous) {
      throw new OdontogramValidationError("Bridge teeth must be contiguous.");
    }

    const normalizedTeeth = indexes.map((index) => arch[index]);
    const id = `${dentition}:${normalizedTeeth.join("-")}`;
    if (seen.has(id)) {
      throw new OdontogramValidationError("Duplicate odontogram bridge.");
    }
    seen.add(id);

    return {
      id,
      dentition,
      teeth: normalizedTeeth,
    };
  });
}

function normalizeGeneralAssessment(value: unknown): GeneralAssessmentState {
  if (!isRecord(value)) {
    throw new OdontogramValidationError("Invalid general assessment.");
  }

  const result: GeneralAssessmentState = {
    both: {},
    upper: {},
    lower: {},
    notes: {
      both: "",
      upper: "",
      lower: "",
    },
  };

  for (const scope of ["both", "upper", "lower"] as const) {
    const scopeValue = value[scope];
    if (!isRecord(scopeValue)) {
      throw new OdontogramValidationError("Invalid assessment scope.");
    }

    const allowedGroups = quickDiagnosisOptions[scope];
    for (const [group, selected] of Object.entries(scopeValue)) {
      const options = allowedGroups[group as keyof typeof allowedGroups];
      if (
        !options ||
        typeof selected !== "string" ||
        !(options as readonly string[]).includes(selected)
      ) {
        throw new OdontogramValidationError("Invalid assessment entry.");
      }
      result[scope][group] = selected;
    }
  }

  const notes = value.notes;
  if (notes !== undefined) {
    if (!isRecord(notes)) {
      throw new OdontogramValidationError("Invalid assessment notes.");
    }
    for (const scope of ["both", "upper", "lower"] as const) {
      const note = notes[scope];
      if (typeof note !== "string" || note.length > 500) {
        throw new OdontogramValidationError("Invalid assessment note.");
      }
      result.notes[scope] = note;
    }
  }

  return result;
}

function conditionConcept(condition: string) {
  if (condition === "existing") return "restoration";
  if (condition === "inlayOnlay") return "inlay-onlay";
  if (condition === "planned") return "treatment";
  return condition;
}

function conditionKind(condition: string): OdontogramEntryKind {
  if (condition === "existing" || condition === "inlayOnlay") {
    return "restoration";
  }
  if (condition === "planned") return "procedure";
  return "condition";
}

function conditionStatus(condition: string): OdontogramEntryStatus {
  if (condition === "existing" || condition === "inlayOnlay") return "existing";
  if (condition === "planned") return "planned";
  if (condition === "watch") return "monitoring";
  return "observed";
}

function defaultMarkerTarget(marker: string): "tooth" | "crown" | "root" {
  if (marker === "caries" || marker === "crown" || marker === "fracture") {
    return "crown";
  }
  if (marker === "rootCanal" || marker === "periapical") return "root";
  return "tooth";
}

function markerKind(marker: string): OdontogramEntryKind {
  if (marker === "implant" || marker === "crown") return "prosthesis";
  if (marker === "rootCanal" || marker === "extraction") return "procedure";
  return "condition";
}

function markerStatus(marker: string): OdontogramEntryStatus {
  if (marker === "implant" || marker === "crown" || marker === "rootCanal") {
    return "existing";
  }
  if (marker === "extraction") return "planned";
  return "observed";
}

function dentitionForTooth(tooth: string): "adult" | "primary" {
  return Number(tooth[0]) > 4 ? "primary" : "adult";
}

function assertContiguousSpan(teeth: string[]) {
  const arch = arches.find((candidate) => candidate.includes(teeth[0] as never));
  if (!arch || teeth.some((tooth) => !arch.includes(tooth as never))) {
    throw new OdontogramValidationError("Span teeth must share an arch.");
  }
  const indexes = teeth
    .map((tooth) => arch.indexOf(tooth as never))
    .sort((left, right) => left - right);
  const contiguous = indexes.every(
    (index, position) =>
      index >= 0 && (position === 0 || index === indexes[position - 1] + 1),
  );
  if (!contiguous) {
    throw new OdontogramValidationError("Span teeth must be contiguous.");
  }
}

function isSurfaceForTooth(tooth: string, surface: string) {
  if (["M", "D", "B", "L"].includes(surface)) {
    return true;
  }

  const position = Number(tooth[1]);
  return position <= 3 ? surface === "I" : surface === "O";
}

function isTooth(value: string): value is (typeof arches)[number][number] {
  return allTeeth.has(value as (typeof arches)[number][number]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
