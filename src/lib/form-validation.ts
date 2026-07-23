import "server-only";

export type ParsedDate = Date | "invalid" | null;

export function requiredString(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export function optionalString(value: FormDataEntryValue | null) {
  const parsed = requiredString(value);

  return parsed.length > 0 ? parsed : null;
}

export function splitList(
  value: FormDataEntryValue | null,
  separator: RegExp = /[\n,]/,
) {
  return String(value ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseMoney(value: FormDataEntryValue | null) {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/₫|vnd|đ/g, "");

  if (!cleaned) {
    return null;
  }

  const suffixMatch = cleaned.match(/^(.*?)(k|nghin|ngan|ngàn|m|tr|trieu|triệu|ty|tỷ)$/u);

  if (suffixMatch) {
    const numericValue = Number(suffixMatch[1].replace(/,/g, ".").replace(/[^0-9.]/g, ""));

    if (!Number.isFinite(numericValue)) {
      return null;
    }

    const suffix = suffixMatch[2];
    const multiplier =
      suffix === "k" || suffix === "nghin" || suffix === "ngan" || suffix === "ngàn"
        ? 1_000
        : suffix === "ty" || suffix === "tỷ"
          ? 1_000_000_000
          : 1_000_000;

    return Math.round(numericValue * multiplier);
  }

  const normalized = cleaned.replace(/\D/g, "");
  const amount = Number(normalized);

  return normalized && Number.isFinite(amount) ? amount : null;
}

export function parseDateInVietnam(value: FormDataEntryValue | null): ParsedDate {
  const parsed = requiredString(value);

  if (!parsed) {
    return null;
  }

  const date = new Date(`${parsed}T00:00:00+07:00`);

  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

export function parseEndOfDateInVietnam(
  value: FormDataEntryValue | null,
  fallback: () => Date,
) {
  const parsed = requiredString(value);

  if (!parsed) {
    return fallback();
  }

  const date = new Date(`${parsed}T23:59:00+07:00`);

  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

export function parseDateTimeInVietnam(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00+07:00`);

  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}

export function parseLowercaseTags(value: FormDataEntryValue | null, limit = 6) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

export function databaseActorId(userId: string) {
  return userId.startsWith("demo-") ? null : userId;
}
