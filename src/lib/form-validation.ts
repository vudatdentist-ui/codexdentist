import "server-only";
import { parseMoneyText } from "@/shared/money";

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
  return parseMoneyText(String(value ?? ""));
}

export function parseDateInVietnam(value: FormDataEntryValue | null): ParsedDate {
  const parsed = requiredString(value);

  if (!parsed) {
    return null;
  }

  const date = new Date(`${parsed}T00:00:00+07:00`);

  return validCalendarDate(parsed) && !Number.isNaN(date.getTime()) ? date : "invalid";
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

  return validCalendarDate(parsed) && !Number.isNaN(date.getTime()) ? date : "invalid";
}

export function parseDateTimeInVietnam(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00+07:00`);

  return validCalendarDate(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && !Number.isNaN(parsed.getTime()) ? parsed : "invalid";
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

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
