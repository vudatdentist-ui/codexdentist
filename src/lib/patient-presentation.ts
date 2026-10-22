import type { Patient } from "@/lib/data";
import type { Language } from "@/components/AppLanguage";
export function padCodeNumber(value: number, digits: number) {
  return String(Math.max(Math.trunc(value), 0)).padStart(digits, "0");
}

export function stableNumberFromText(value: string, max: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % max;
  }

  return hash + 1;
}

export function patientCodeFor(patient: Pick<Patient, "id" | "patientCode"> | null | undefined) {
  if (!patient) {
    return "PT000000";
  }

  if (patient.patientCode) {
    return patient.patientCode;
  }

  const numericId = patient.id.match(/\d+/g)?.join("");
  const sequence = numericId
    ? Number(numericId.slice(-6))
    : stableNumberFromText(patient.id, 999999);

  return `PT${padCodeNumber(sequence || 0, 6)}`;
}

export function patientClassCodeFor(patient: Pick<Patient, "age" | "flags">) {
  const flags = patient.flags.map((flag) => flag.toLowerCase());

  if (patient.age > 0 && patient.age < 16) {
    return "PE";
  }

  if (flags.some((flag) => flag.includes("pediatric") || flag.includes("guardian"))) {
    return "PE";
  }

  return "AD";
}

export function patientGenderLabel(gender: string | null | undefined, language: Language) {
  const normalizedGender = String(gender ?? "UNKNOWN").toUpperCase();

  if (normalizedGender === "FEMALE") {
    return language === "vi" ? "Nữ" : "Female";
  }

  if (normalizedGender === "MALE") {
    return language === "vi" ? "Nam" : "Male";
  }

  if (normalizedGender === "OTHER") {
    return language === "vi" ? "Khác" : "Other";
  }

  return language === "vi" ? "Chưa rõ" : "Unknown";
}

export function patientLeadSourceOptions(language: Language) {
  return [
    { value: "WALK_IN", label: language === "vi" ? "Vãng lai" : "Walk-in" },
    { value: "FACEBOOK_ADS", label: "Facebook Ads" },
    { value: "GOOGLE_ADS", label: "Google Ads" },
    { value: "TIKTOK", label: "TikTok" },
    { value: "SOCIAL", label: language === "vi" ? "Social / cộng đồng" : "Social / community" },
    { value: "TELESALE", label: "Telesale" },
    { value: "WEBSITE", label: "Website" },
    { value: "ZALO", label: "Zalo" },
    {
      value: "PATIENT_REFERRAL",
      label: language === "vi" ? "Bệnh nhân giới thiệu" : "Patient referral",
    },
    {
      value: "STAFF_REFERRAL",
      label: language === "vi" ? "Nhân sự giới thiệu" : "Staff referral",
    },
    { value: "PARTNER", label: language === "vi" ? "Đối tác" : "Partner" },
    { value: "OTHER", label: language === "vi" ? "Khác" : "Other" },
  ];
}
