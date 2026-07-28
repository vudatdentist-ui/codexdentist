import type { Language } from "@/components/AppLanguage";

export const UNKNOWN_JOURNEY_TIMELINE_TIMESTAMP = Number.MAX_SAFE_INTEGER;

export function journeyTimelineTimestamp(
  value: string | number | null | undefined,
  fallback = UNKNOWN_JOURNEY_TIMELINE_TIMESTAMP,
) {
  if (typeof value === "number") {
    return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
      ? value
      : fallback;
  }

  if (!value) {
    return fallback;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? fallback : timestamp;
}

export function formatJourneyTimelineDateTime(
  timestamp: number,
  fallback: string,
  language: Language,
) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const parts = new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("day")}/${part("month")}/${part("year")} · ${part("hour")}:${part("minute")}`;
}

export function journeyTimelineDayKey(timestamp: number) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatJourneyTimelineDay(
  timestamp: number,
  language: Language,
) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return language === "vi" ? "Chưa rõ thời gian" : "Unknown date";
  }

  const label = new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatJourneyTimelineTime(
  timestamp: number,
  fallback: string,
  language: Language,
) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function compareJourneyTimelineEvents(
  left: { id: string; sortMs: number },
  right: { id: string; sortMs: number },
) {
  if (left.sortMs !== right.sortMs) {
    return left.sortMs < right.sortMs ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}
