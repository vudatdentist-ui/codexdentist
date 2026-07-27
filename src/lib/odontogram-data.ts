import type { OdontogramData } from "codexdentist-odontogram";

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
const conditionIds = new Set(["caries", "existing", "planned", "watch"]);
const markerIds = new Set([
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
  version: 1,
  surfaceState: {},
  anatomyState: {},
  markerState: {},
  bridges: [],
  quickDiagnosis: {
    both: {},
    upper: {},
    lower: {},
  },
};

export class OdontogramValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdontogramValidationError";
  }
}

export function normalizeOdontogramData(value: unknown): OdontogramData {
  if (!isRecord(value) || value.version !== 1) {
    throw new OdontogramValidationError("Invalid odontogram version.");
  }

  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new OdontogramValidationError("Odontogram snapshot is too large.");
  }

  return {
    version: 1,
    surfaceState: normalizeSurfaceState(value.surfaceState),
    anatomyState: normalizeAnatomyState(value.anatomyState),
    markerState: normalizeMarkerState(value.markerState),
    bridges: normalizeBridges(value.bridges),
    quickDiagnosis: normalizeQuickDiagnosis(value.quickDiagnosis),
  };
}

function normalizeSurfaceState(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 260) {
    throw new OdontogramValidationError("Invalid odontogram surfaces.");
  }

  const result: Record<string, "caries" | "existing" | "planned" | "watch"> = {};

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
    result[key] = condition as "caries" | "existing" | "planned" | "watch";
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

  const result: Record<string, "caries" | "existing" | "planned" | "watch"> = {};

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
    result[key] = condition as "caries" | "existing" | "planned" | "watch";
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

function normalizeQuickDiagnosis(value: unknown) {
  if (!isRecord(value)) {
    throw new OdontogramValidationError("Invalid quick diagnosis.");
  }

  const result: OdontogramData["quickDiagnosis"] = {
    both: {},
    upper: {},
    lower: {},
  };

  for (const scope of ["both", "upper", "lower"] as const) {
    const scopeValue = value[scope];
    if (!isRecord(scopeValue)) {
      throw new OdontogramValidationError("Invalid quick diagnosis scope.");
    }

    const allowedGroups = quickDiagnosisOptions[scope];
    for (const [group, selected] of Object.entries(scopeValue)) {
      const options = allowedGroups[group as keyof typeof allowedGroups];
      if (
        !options ||
        typeof selected !== "string" ||
        !(options as readonly string[]).includes(selected)
      ) {
        throw new OdontogramValidationError("Invalid quick diagnosis entry.");
      }
      result[scope][group] = selected;
    }
  }

  return result;
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
