import type { Patient } from "@/lib/data";
import type { ServiceStepSummary } from "@/lib/services-types";

export function normalizePatientSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase()
    .trim();
}

export function patientCodeFor(patient: Pick<Patient, "id" | "patientCode">) {
  if (patient.patientCode) {
    return patient.patientCode;
  }

  let hash = 0;
  for (let index = 0; index < patient.id.length; index += 1) {
    hash = (hash * 31 + patient.id.charCodeAt(index)) % 999999;
  }

  return `PT${String(hash + 1).padStart(6, "0")}`;
}

export function genderLabel(value: string | null | undefined) {
  switch (String(value ?? "").toUpperCase()) {
    case "MALE":
      return "Nam";
    case "FEMALE":
      return "Nữ";
    case "OTHER":
      return "Khác";
    default:
      return "Chưa rõ";
  }
}

export const patientLeadSources = [
  ["WALK_IN", "Vãng lai"],
  ["FACEBOOK_ADS", "Facebook Ads"],
  ["GOOGLE_ADS", "Google Ads"],
  ["TIKTOK", "TikTok"],
  ["SOCIAL", "Social / cộng đồng"],
  ["TELESALE", "Telesale"],
  ["WEBSITE", "Website"],
  ["ZALO", "Zalo"],
  ["PATIENT_REFERRAL", "Bệnh nhân giới thiệu"],
  ["STAFF_REFERRAL", "Nhân sự giới thiệu"],
  ["PARTNER", "Đối tác"],
  ["OTHER", "Khác"],
] as const;

export function leadSourceLabel(value: string | null | undefined) {
  const normalized = String(value ?? "WALK_IN").toUpperCase();
  return patientLeadSources.find(([key]) => key === normalized)?.[1] ?? normalized;
}

export function splitClinicalObjective(objective: string | null | undefined) {
  const fields = {
    objective: "",
    medicalHistory: "",
    temperature: "",
    bloodPressure: "",
    heartRate: "",
  };
  let remaining = objective?.trim() ?? "";
  const historyMatch = remaining.match(/(?:^|\n\n)Bệnh sử:\s*([\s\S]*?)(?=\n\nSinh hiệu:|$)/);

  if (historyMatch) {
    fields.medicalHistory = historyMatch[1].trim();
    remaining = remaining.replace(historyMatch[0], "").trim();
  }

  const vitalsMatch = remaining.match(/(?:^|\n\n)Sinh hiệu:\s*([\s\S]*?)$/);
  if (vitalsMatch) {
    const vitals = vitalsMatch[1];
    fields.temperature = vitals.match(/Nhiệt độ:\s*([^;\n]+)/)?.[1]?.trim() ?? "";
    fields.bloodPressure = vitals.match(/Huyết áp:\s*([^;\n]+)/)?.[1]?.trim() ?? "";
    fields.heartRate = vitals.match(/(?:Mạch|Nhịp tim):\s*([^;\n]+)/)?.[1]?.trim() ?? "";
    remaining = remaining.replace(vitalsMatch[0], "").trim();
  }

  fields.objective = remaining;
  return fields;
}

export function serviceProgressLabel(
  percent: number,
  status?: string,
  steps: ServiceStepSummary[] = [],
) {
  if (status === "CANCELLED") return "Đã hủy";
  if (percent <= 0) return "Đã lên kế hoạch";
  if (percent >= 100 || status === "COMPLETED") return "Hoàn tất";

  const rounded = Math.round(percent);
  const step = steps.find(
    (candidate) => Math.round(candidate.defaultProgress ?? -1) === rounded,
  );
  return step ? `${step.sequence}. ${step.name} · ${rounded}%` : `${rounded}%`;
}

export function serviceProgressOptions(current: number, steps: ServiceStepSummary[] = []) {
  return Array.from(
    new Set([
      Math.round(current),
      ...steps
        .map((step) => step.defaultProgress)
        .filter((value): value is number => Number.isFinite(value ?? NaN))
        .map(Math.round),
      100,
    ]),
  )
    .filter((value) => value >= Math.round(current))
    .sort((left, right) => left - right);
}

export function noticeLabel(notice: string | null) {
  const labels: Record<string, string> = {
    "patient-created": "Đã tạo hồ sơ bệnh nhân.",
    "patient-updated": "Đã cập nhật hồ sơ bệnh nhân.",
    "patient-consent-updated": "Đã cập nhật trạng thái đồng thuận.",
    "patient-source-updated": "Đã cập nhật nguồn khách.",
    "clinical-created": "Đã thêm ghi chú khám vào bệnh án.",
    "clinical-locked": "Đã hoàn tất ghi chú khám.",
    "journey-service-created": "Đã thêm dịch vụ điều trị.",
    "journey-discount-updated": "Đã cập nhật giảm giá dịch vụ.",
    "journey-service-deleted": "Đã xóa dịch vụ điều trị.",
    "journey-progress-recorded": "Đã ghi nhận tiến độ dịch vụ.",
    "journey-comment-created": "Đã thêm ghi chú timeline.",
  };

  return notice ? labels[notice] ?? notice : null;
}
