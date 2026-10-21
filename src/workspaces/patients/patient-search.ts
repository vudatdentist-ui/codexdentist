import type { Patient, Appointment } from "@/lib/data";
import type { StoryLanguage as Language } from "@/workspaces/workspace-story";

function padCodeNumber(value: number, digits: number) {
  return String(Math.max(Math.trunc(value), 0)).padStart(digits, "0");
}

function stableNumberFromText(value: string, max: number) {
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

export function patientSearchDisplayLabel(patient: PatientSearchRecord) {
  return `${patientCodeFor(patient)} - ${patient.name} - ${patient.phone}`;
}

function patientClassCodeFor(patient: Pick<Patient, "age" | "flags">) {
  const flags = patient.flags.map((flag) => flag.toLowerCase());

  if (patient.age > 0 && patient.age < 16) {
    return "PE";
  }

  if (flags.some((flag) => flag.includes("pediatric") || flag.includes("guardian"))) {
    return "PE";
  }

  return "AD";
}

function patientGenderLabel(gender: string | null | undefined, language: Language) {
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

export type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> &
  Partial<
    Pick<
      Patient,
      | "address"
      | "age"
      | "city"
      | "clinicId"
      | "consent"
      | "email"
      | "flags"
      | "gender"
      | "guardianName"
      | "lastVisit"
      | "leadSource"
      | "nationalId"
      | "patientCode"
      | "treatmentProgress"
      | "visitReason"
    >
  >;

function patientLeadSourceOptions(language: Language) {
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

function patientLeadSourceLabel(source: string | null | undefined, language: Language) {
  const normalizedSource = String(source ?? "WALK_IN").toUpperCase();

  return (
    patientLeadSourceOptions(language).find((option) => option.value === normalizedSource)
      ?.label ?? normalizedSource
  );
}

export function isJourneyTodayAppointment(appointment: Appointment) {
  if (!appointment.startsAt) {
    return true;
  }

  const startsAt = new Date(appointment.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    return false;
  }

  const today = new Date();

  return (
    startsAt.getFullYear() === today.getFullYear() &&
    startsAt.getMonth() === today.getMonth() &&
    startsAt.getDate() === today.getDate()
  );
}

export function patientVisitSortValue(patient: PatientSearchRecord) {
  const dateValue = Date.parse(String(patient.lastVisit ?? ""));

  if (!Number.isNaN(dateValue)) {
    return dateValue;
  }

  return stableNumberFromText(patient.id, 100000);
}

function patientMatchesExactSelectorSearch(patient: PatientSearchRecord, query: string) {
  return matchesChartSearch(query, [
    patient.name,
    patient.phone,
    patientCodeFor(patient),
    typeof patient.age === "number" && patient.flags ? patientClassCodeFor(patient as Patient) : null,
    patient.email,
    patientGenderLabel(patient.gender, "vi"),
    patientGenderLabel(patient.gender, "en"),
    patientLeadSourceLabel(patient.leadSource, "vi"),
    patientLeadSourceLabel(patient.leadSource, "en"),
    patient.visitReason,
    patient.nationalId,
    patient.address,
    patient.city,
    patient.guardianName,
    patient.consent,
    ...(patient.flags ?? []),
  ]);
}

export function patientSearchMatches(patients: PatientSearchRecord[], query: string) {
  if (!query) {
    return patients;
  }

  return patients
    .map((patient, index) => ({
      patient,
      index,
      rank: patientSearchRank(patient, query),
    }))
    .filter((item) => item.rank < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.patient);
}

function patientSearchRank(patient: PatientSearchRecord, query: string) {
  const name = normalizeSearchText(patient.name);
  const phone = normalizeSearchText(patient.phone);
  const code = normalizeSearchText(patientCodeFor(patient));
  const nameTokens = name.split(/\s+/).filter(Boolean);

  if (code.startsWith(query) || phone.startsWith(query)) {
    return 0;
  }

  if (nameTokens.some((token) => token.startsWith(query))) {
    return 1;
  }

  if (name.includes(query)) {
    return 2;
  }

  if (code.includes(query) || phone.includes(query)) {
    return 3;
  }

  return patientMatchesExactSelectorSearch(patient, query)
    ? 4
    : Number.POSITIVE_INFINITY;
}

export function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function matchesChartSearch(
  query: string,
  values: Array<string | number | null | undefined>,
) {
  if (!query) {
    return true;
  }

  return values.some((value) => normalizeSearchText(value).includes(query));
}

