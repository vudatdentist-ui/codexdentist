"use client";

import { Activity, CheckCircle2, ClipboardList, FileText, Printer, Search, Settings, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  createMedicationAction,
  createPrescriptionAction,
  createPrescriptionTemplateAction,
  markPrescriptionPrintedAction,
  signPrescriptionAction,
} from "@/app/(app)/pharmacy/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import type { Patient } from "@/lib/data";
import type { PatientWorkspace } from "@/lib/patient-types";
import type { MedicationCatalogSummary, PharmacyWorkspace } from "@/lib/pharmacy-types";

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function patientCodeFor(patient: Pick<Patient, "id"> & Partial<Pick<Patient, "patientCode">> | null | undefined) {
  if (!patient) return "PT000000";
  if (patient.patientCode) return patient.patientCode;
  const digits = patient.id.replace(/\D/g, "").slice(-6).padStart(6, "0");
  return `PT${digits}`;
}

type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> &
  Partial<Pick<Patient, "email" | "patientCode">>;

function patientSearchDisplayLabel(patient: PatientSearchRecord) {
  return patientCodeFor(patient) + " - " + patient.name + " - " + patient.phone;
}

function PatientSearchCombobox({
  disabled = false,
  hideIcon = false,
  query,
  onQueryChange,
  matches,
  selectedPatient,
  placeholder,
  selectLabel,
  noResultsLabel,
  onSelect,
}: {
  disabled?: boolean;
  hideIcon?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  matches: PatientSearchRecord[];
  selectedPatient?: PatientSearchRecord | null;
  placeholder: string;
  selectLabel: string;
  noResultsLabel: string;
  onSelect: (patient: PatientSearchRecord) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = normalizeSearchText(query.trim());
  const selectedPatientLabel = selectedPatient ? patientSearchDisplayLabel(selectedPatient) : "";
  const inputValue = query || selectedPatientLabel;
  const visibleMatches = normalizedQuery
    ? matches.filter((patient) => patient.id !== selectedPatient?.id).slice(0, 8)
    : [];
  const shouldShowResults = isOpen && normalizedQuery.length > 0;

  return (
    <div className="patient-search-combobox">
      <label className="search-field topbar-search-field patient-search-input">
        {!hideIcon && <Search size={16} aria-hidden="true" />}
        <input
          ref={inputRef}
          aria-autocomplete="list"
          aria-expanded={shouldShowResults}
          aria-label={selectLabel}
          disabled={disabled}
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);

            if (!query && selectedPatientLabel) {
              requestAnimationFrame(() => inputRef.current?.select());
            }
          }}
          placeholder={placeholder}
          value={inputValue}
        />
      </label>
      {shouldShowResults ? (
        <div className="patient-search-results" role="listbox" aria-label={selectLabel}>
          {visibleMatches.length > 0 ? (
            visibleMatches.map((patient) => (
              <button
                className="patient-search-option"
                key={patient.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(patient);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>{patient.name}</strong>
                <span>
                  {patientCodeFor(patient)} - {patient.phone}
                  {patient.email ? " - " + patient.email : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="patient-search-empty">{noResultsLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, _language: Language) {
  return message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "pharmacy-medication-saved": { vi: "Đã lưu thuốc vào thư viện.", en: "Medication catalog item saved." },
    "pharmacy-template-saved": { vi: "Đã lưu mẫu đơn thuốc.", en: "Prescription template saved." },
    "pharmacy-prescription-created": { vi: "Đã tạo đơn thuốc.", en: "Prescription created." },
    "pharmacy-prescription-signed": { vi: "Đã ký đơn thuốc.", en: "Prescription signed." },
    "pharmacy-prescription-printed": { vi: "Đã ghi nhận đơn thuốc đã in.", en: "Prescription marked as printed." },
    "pharmacy-prescription-unsigned": { vi: "Cần ký đơn thuốc trước khi ghi nhận đã in.", en: "Sign the prescription before marking it printed." },
    "pharmacy-prescription-not-draft": { vi: "Chỉ đơn thuốc nháp mới được ký.", en: "Only draft prescriptions can be signed." },
    "pharmacy-denied": { vi: "Vai trò này không thể sửa đơn thuốc.", en: "This role cannot change prescriptions." },
    "pharmacy-missing": { vi: "Cần điền đủ thông tin đơn thuốc bắt buộc.", en: "Complete the required pharmacy fields." },
    "pharmacy-patient-missing": { vi: "Cần chọn bệnh nhân hợp lệ cho đơn thuốc.", en: "Select a valid patient for this prescription." },
    "pharmacy-item-missing": { vi: "Cần có ít nhất một thuốc trong đơn.", en: "Add at least one medication item." },
    "pharmacy-item-invalid": { vi: "Mỗi dòng thuốc cần có tên thuốc và cách dùng rõ ràng.", en: "Every medication row needs a drug and clear directions." },
    "pharmacy-item-duplicate": { vi: "Cần bỏ dòng thuốc bị trùng trước khi lưu.", en: "Remove duplicate medication rows before saving." },
    "pharmacy-prescription-missing": { vi: "Không tìm thấy đơn thuốc.", en: "The prescription could not be found." },
    "pharmacy-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const viStatus: Record<string, string> = {
    DRAFT: "Nháp",
    SIGNED: "Đã ký",
    PRINTED: "Đã in",
    VOIDED: "Đã hủy",
  };

  return language === "vi" ? viStatus[status] ?? status : status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();
  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}
function pharmacyMedicationDisplayName(medication: {
  genericName: string;
  brandName: string | null;
  strength: string | null;
}) {
  const strength = medication.strength ? ` ${medication.strength}` : "";
  const genericName = medication.genericName.trim();
  const brandName = medication.brandName?.trim();
  const isCombination = /[+/]|clavulanic|clavulanate|phối hợp/i.test(genericName);

  if (brandName && isCombination) {
    return `${brandName}${strength}`;
  }

  if (brandName) {
    return `${genericName}${strength} (${brandName})`;
  }

  return `${genericName}${strength}`;
}

function mergePharmacyDirections(sig: string, instructions: string | null) {
  const cleanSig = sig.trim();
  const cleanInstructions = instructions?.trim() ?? "";

  if (!cleanInstructions) {
    return cleanSig;
  }

  if (normalizeSearchText(cleanSig) === normalizeSearchText(cleanInstructions)) {
    return cleanSig;
  }

  return `${cleanSig}\n${cleanInstructions}`;
}

function pharmacyMedicationGroupName(
  medication: {
    code: string;
    genericName: string;
    form: string | null;
  },
  language: Language,
) {
  const text = `${medication.code} ${medication.genericName} ${medication.form ?? ""}`.toLowerCase();
  const vi = language === "vi";

  if (/amox|augmentin|clavulan|metro|clinda|cepha|azith|spira|rodogyl/.test(text)) {
    return vi ? "Kháng sinh" : "Antibiotics";
  }

  if (/para|ibuprofen|diclo|celecox|alaxan|pain|nsaid/.test(text)) {
    return vi ? "Chống viêm và giảm đau" : "Anti-inflammatory and analgesics";
  }

  if (/chlorhex|povidone|betadine|mouth|súc/.test(text)) {
    return vi ? "Nước súc miệng và sát khuẩn" : "Mouthwash and antiseptics";
  }

  if (/omep|gastro|dạ dày/.test(text)) {
    return vi ? "Bảo vệ dạ dày và hỗ trợ" : "Gastric protection and support";
  }

  if (/tranex|transamin|bleed|máu/.test(text)) {
    return vi ? "Cầm máu" : "Hemostasis";
  }

  return vi ? "Khác" : "Other";
}

type PharmacyPrescriptionRow = {
  id: string;
  medicationId: string;
  medicationQuery: string;
  drugName: string;
  dose: string;
  route: string;
  frequency: string;
  sig: string;
  quantity: string;
  durationDays: string;
  instructions: string;
};

function createPharmacyPrescriptionRow(): PharmacyPrescriptionRow {
  return {
    id: `rx-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    medicationId: "",
    medicationQuery: "",
    drugName: "",
    dose: "",
    route: "",
    frequency: "",
    sig: "",
    quantity: "",
    durationDays: "",
    instructions: "",
  };
}

function pharmacyMedicationIndication(
  medication: MedicationCatalogSummary,
  language: Language,
) {
  const group = pharmacyMedicationGroupName(medication, language);
  const vi = language === "vi";

  if (/giảm đau|pain|NSAID|Paracetamol/i.test(group)) {
    return vi
      ? "Đau răng, đau sau thủ thuật, sốt hoặc đau nhẹ đến vừa theo đánh giá của bác sĩ."
      : "Dental pain, post-procedure pain, fever, or mild to moderate pain as assessed by the clinician.";
  }

  if (/kháng sinh|antibiotic/i.test(group)) {
    return vi
      ? "Nhiễm trùng răng miệng có chỉ định kháng sinh, áp xe, nhiễm trùng lan tỏa hoặc dự phòng theo phác đồ."
      : "Dental infection with antibiotic indication, abscess, spreading infection, or protocol-based prophylaxis.";
  }

  if (/súc miệng|sát khuẩn|mouthwash|antiseptic/i.test(group)) {
    return vi
      ? "Hỗ trợ kiểm soát mảng bám, viêm nướu, chăm sóc sau thủ thuật hoặc sát khuẩn khoang miệng."
      : "Adjunct plaque control, gingivitis support, post-procedure care, or oral antisepsis.";
  }

  if (/dạ dày|gastric/i.test(group)) {
    return vi
      ? "Hỗ trợ bảo vệ dạ dày khi bác sĩ đánh giá có nguy cơ với thuốc giảm đau/kháng viêm."
      : "Gastric protection support when anti-inflammatory/pain medicine risk is assessed.";
  }

  if (/cầm máu|hemostasis/i.test(group)) {
    return vi
      ? "Hỗ trợ kiểm soát chảy máu khi có chỉ định và đã đánh giá nguy cơ huyết khối."
      : "Bleeding control support when indicated and thrombotic risk has been assessed.";
  }

  return vi ? "Theo chỉ định lâm sàng." : "As clinically indicated.";
}

function pharmacyMedicationDispenseHint(medication: MedicationCatalogSummary) {
  const code = medication.code.toUpperCase();

  if (code.includes("CHX") || code.includes("POVI")) {
    return "1 chai";
  }

  if (code.includes("AUG") || code.includes("METRO") || code.includes("AMOX")) {
    return "21 viên";
  }

  if (code.includes("IBU") || code.includes("DICLO") || code.includes("PARA-IBU")) {
    return "9 viên";
  }

  if (code.includes("PARA")) {
    return "12 viên";
  }

  return medication.form?.toLowerCase().includes("nước") ? "1 chai" : "Theo đơn";
}

function pharmacyMedicationNotes(
  medication: MedicationCatalogSummary,
  language: Language,
) {
  const vi = language === "vi";
  const notes = [
    medication.defaultDose
      ? vi
        ? `Liều thường dùng: ${medication.defaultDose}.`
        : `Usual dose: ${medication.defaultDose}.`
      : null,
    medication.frequency
      ? vi
        ? `Tần suất gợi ý: ${medication.frequency}.`
        : `Suggested frequency: ${medication.frequency}.`
      : null,
    vi
      ? "Điều chỉnh theo tuổi, cân nặng, bệnh nền, dị ứng và thuốc đang dùng."
      : "Adjust for age, weight, comorbidities, allergies, and current medicines.",
  ];

  return notes.filter(Boolean);
}

function pharmacyMedicationInteractions(
  medication: MedicationCatalogSummary,
  language: Language,
) {
  const text = normalizeSearchText(
    `${medication.genericName} ${medication.brandName ?? ""} ${medication.warnings.join(" ")}`,
  );
  const vi = language === "vi";

  if (/ibuprofen|diclofenac|celecoxib|nsaid|kháng viêm/.test(text)) {
    return vi
      ? "Thận trọng khi dùng cùng thuốc chống đông, corticosteroid, NSAID khác, bệnh dạ dày/thận."
      : "Use caution with anticoagulants, corticosteroids, other NSAIDs, gastric or kidney disease.";
  }

  if (/metronidazole|rodogyl/.test(text)) {
    return vi
      ? "Tránh rượu; kiểm tra tương tác với thuốc chống đông và thuốc chuyển hóa qua gan."
      : "Avoid alcohol; check anticoagulants and hepatic-metabolism interactions.";
  }

  if (/azithromycin|zithromax/.test(text)) {
    return vi
      ? "Thận trọng thuốc kéo dài QT và bệnh gan."
      : "Use caution with QT-prolonging drugs and liver disease.";
  }

  if (/paracetamol|acetaminophen/.test(text)) {
    return vi
      ? "Không phối hợp nhiều thuốc cùng chứa paracetamol; thận trọng bệnh gan/rượu."
      : "Avoid duplicate paracetamol products; use caution with liver disease/alcohol.";
  }

  if (/amoxicillin|augmentin|cephalexin|clindamycin/.test(text)) {
    return vi
      ? "Kiểm tra dị ứng kháng sinh; hỏi thuốc đang dùng và tiền sử tiêu chảy do kháng sinh."
      : "Check antibiotic allergy; review current medicines and antibiotic-associated diarrhea history.";
  }

  return vi ? "Kiểm tra thuốc đang dùng trước khi kê." : "Review current medicines before prescribing.";
}

function pharmacyMedicationSideEffects(
  medication: MedicationCatalogSummary,
  language: Language,
) {
  const text = normalizeSearchText(`${medication.genericName} ${medication.brandName ?? ""}`);
  const vi = language === "vi";

  if (/chlorhexidine|povidone/.test(text)) {
    return vi
      ? "Kích ứng niêm mạc, thay đổi vị giác hoặc đổi màu răng/lưỡi tạm thời."
      : "Mucosal irritation, taste disturbance, or temporary tooth/tongue staining.";
  }

  if (/ibuprofen|diclofenac|celecoxib/.test(text)) {
    return vi
      ? "Đau dạ dày, buồn nôn, phù, tăng nguy cơ chảy máu hoặc ảnh hưởng thận ở người nguy cơ."
      : "Gastric pain, nausea, edema, bleeding risk, or kidney effects in at-risk patients.";
  }

  if (/paracetamol/.test(text)) {
    return vi
      ? "Buồn nôn, dị ứng hiếm gặp; quá liều có nguy cơ độc gan."
      : "Nausea, rare allergy; overdose may cause liver toxicity.";
  }

  if (/amoxicillin|augmentin|metronidazole|azithromycin|clindamycin|cephalexin|rodogyl/.test(text)) {
    return vi
      ? "Rối loạn tiêu hóa, dị ứng, phát ban; một số thuốc có thể gây tiêu chảy hoặc vị kim loại."
      : "GI upset, allergy, rash; some medicines may cause diarrhea or metallic taste.";
  }

  return vi ? "Theo dõi bất thường và ngừng thuốc nếu có phản ứng nghiêm trọng." : "Monitor adverse effects and stop if serious reactions occur.";
}

export function PharmacyPanel({
  patientWorkspace,
  pharmacyWorkspace,
  visibleClinicIds,
}: {
  patientWorkspace?: PatientWorkspace | null;
  pharmacyWorkspace?: PharmacyWorkspace | null;
  visibleClinicIds: Set<string>;
}) {
  const { language } = useAppLanguage();
  const [activePharmacySection, setActivePharmacySection] = useState<
    "prescriptions" | "medications" | "templates"
  >("prescriptions");
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const patients = (
    pharmacyWorkspace?.patients ??
    patientWorkspace?.patients.map((patient) => ({
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      clinicId: patient.clinicId,
      medicalAlerts: patient.flags,
    })) ??
    []
  ).filter((patient) => visibleClinicIds.has(patient.clinicId));
  const medications = (pharmacyWorkspace?.medications ?? []).filter(
    (medication) => medication.active,
  );
  const templates = (pharmacyWorkspace?.templates ?? []).filter(
    (template) => template.active,
  );
  const prescriptions = (pharmacyWorkspace?.prescriptions ?? []).filter((prescription) =>
    visibleClinicIds.has(prescription.clinicId),
  );
  const canMutate = pharmacyWorkspace?.canMutate ?? false;
  const [pharmacyModal, setPharmacyModal] = useState<
    "prescription" | "template" | "medication" | null
  >(null);
  const [editingMedicationId, setEditingMedicationId] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [printingTemplateId, setPrintingTemplateId] = useState("");
  const [printPatientId, setPrintPatientId] = useState("");
  const [viewingPrescriptionId, setViewingPrescriptionId] = useState("");
  const [prescriptionPatientQuery, setPrescriptionPatientQuery] = useState("");
  const [selectedPrescriptionPatientId, setSelectedPrescriptionPatientId] = useState("");
  const [selectedPrescriptionTemplateId, setSelectedPrescriptionTemplateId] = useState("");
  const [prescriptionDiagnosis, setPrescriptionDiagnosis] = useState("");
  const [prescriptionNotes, setPrescriptionNotes] = useState("");
  const [prescriptionRows, setPrescriptionRows] = useState<PharmacyPrescriptionRow[]>([
    createPharmacyPrescriptionRow(),
  ]);
  const [activeMedicationSearchRowId, setActiveMedicationSearchRowId] = useState<string | null>(null);
  const editingMedication =
    medications.find((medication) => medication.id === editingMedicationId) ?? null;
  const editingTemplate =
    templates.find((template) => template.id === editingTemplateId) ?? null;
  const printingTemplate =
    templates.find((template) => template.id === printingTemplateId) ?? null;
  const selectedPrescriptionPatient =
    patients.find((patient) => patient.id === selectedPrescriptionPatientId) ?? null;
  const selectedPrescriptionTemplate =
    templates.find((template) => template.id === selectedPrescriptionTemplateId) ?? null;
  const viewingPrescription =
    prescriptions.find((prescription) => prescription.id === viewingPrescriptionId) ?? null;
  const prescriptionPatientSearchRecords: PatientSearchRecord[] = useMemo(
    () =>
      patients.map((patient) => ({
        id: patient.id,
        name: patient.name,
        phone: patient.phone ?? "-",
      })),
    [patients],
  );
  const prescriptionPatientSearchMatches = useMemo(() => {
    const query = normalizeSearchText(prescriptionPatientQuery);

    if (!query) {
      return [];
    }

    return prescriptionPatientSearchRecords.filter((patient) =>
      normalizeSearchText(
        `${patientCodeFor(patient)} ${patient.name} ${patient.phone ?? ""} ${patient.email ?? ""}`,
      ).includes(query),
    );
  }, [prescriptionPatientQuery, prescriptionPatientSearchRecords]);
  const medicationGroups = useMemo(() => {
    const groups = new Map<string, typeof medications>();

    for (const medication of medications) {
      const groupName = pharmacyMedicationGroupName(medication, language);
      groups.set(groupName, [...(groups.get(groupName) ?? []), medication]);
    }

    return Array.from(groups.entries()).map(([name, items]) => ({
      name,
      items,
    }));
  }, [language, medications]);
  const text =
    language === "vi"
      ? {
          heading: "Đơn thuốc, thư viện thuốc và mẫu kê đơn",
          addItemIfNeeded: "Thêm thuốc nếu cần",
          brand: "Tên thương mại",
          cancel: "Hủy",
          close: "Đóng",
          code: "Mã",
          createdAt: "Ngày tạo",
          customDrug: "Nhập thuốc",
          days: "Ngày",
          medication: "Thêm thuốc",
          medicationList: "Thư viện thuốc",
          prescription: "Tạo đơn thuốc",
          prescriptionList: "Đơn thuốc",
          template: "Thêm mẫu đơn thuốc",
          templateList: "Mẫu đơn thuốc nha khoa",
          templatePreview: "Xem trước mẫu",
          applyTemplate: "Áp dụng mẫu",
          patient: "Bệnh nhân",
          patientSearchPlaceholder: "Tìm bệnh nhân theo tên, mã, số điện thoại",
          noPatientResults: "Không có bệnh nhân phù hợp",
          selectPatientFirst: "Chọn bệnh nhân bằng ô tìm kiếm trước khi lưu đơn.",
          medicalAlerts: "Cảnh báo y khoa",
          diagnosis: "Chẩn đoán",
          notes: "Ghi chú / dặn dò chung",
          drug: "Thuốc",
          dose: "Liều",
          draftPrintLocked: "Ký đơn trước khi in hoặc ghi nhận đã in.",
          form: "Dạng dùng",
          frequency: "Tần suất",
          generic: "Hoạt chất",
          instructions: "Dặn dò",
          medicationRows: "Thuốc trong đơn",
          markPrinted: "Ghi nhận đã in",
          name: "Tên",
          sig: "Cách dùng",
          quantity: "Số lượng",
          manual: "Tự nhập",
          manualTemplate: "Không dùng mẫu",
          edit: "Chỉnh sửa",
          view: "Xem",
          print: "In",
          prescriber: "Người kê",
          printConfirm: "Ghi nhận đơn thuốc này đã in?",
          route: "Đường dùng",
          addRow: "Thêm dòng thuốc",
          removeRow: "Xóa dòng",
          saveDraft: "Lưu nháp",
          signNow: "Lưu và ký",
          signNowConfirm: "Lưu và ký đơn thuốc này ngay? Sau khi ký, đơn có thể được in chính thức.",
          signConfirm: "Ký đơn thuốc này? Sau khi ký, đơn có thể được in chính thức.",
          metricSigned: "Đã ký",
          metricTemplates: "Mẫu đơn",
          library: "Thư viện",
          noSignature: "Không cần chữ ký",
          rxShort: "Đơn thuốc",
          save: "Lưu",
          sign: "Ký đơn",
          signature: "Chữ ký",
          strength: "Hàm lượng",
          templateShort: "Mẫu",
          warnings: "Cảnh báo",
          commonForm: "Dạng thường dùng",
          indications: "Chỉ định",
          selectedStrength: "Hàm lượng / dạng dùng",
          dispense: "Số lượng gợi ý",
          precautions: "Thận trọng",
          notesHints: "Ghi chú / gợi ý",
          interactions: "Tương tác thuốc",
          sideEffects: "Tác dụng phụ",
          viewDetails: "Xem chi tiết",
          tabPrescriptions: "Đơn thuốc",
          tabMedications: "Thư viện thuốc",
          tabTemplates: "Mẫu đơn thuốc",
          empty: "Chưa có dữ liệu",
        }
      : {
          heading: "Prescriptions, medication library, and templates",
          addItemIfNeeded: "Add item if needed",
          brand: "Brand",
          cancel: "Cancel",
          close: "Close",
          code: "Code",
          createdAt: "Created",
          customDrug: "Enter medication",
          days: "Days",
          medication: "Add medication",
          medicationList: "Medication library",
          prescription: "Create prescription",
          prescriptionList: "Prescriptions",
          template: "Add prescription template",
          templateList: "Dental prescription templates",
          templatePreview: "Template preview",
          applyTemplate: "Apply template",
          patient: "Patient",
          patientSearchPlaceholder: "Search patient by name, code, or phone",
          noPatientResults: "No matching patients",
          selectPatientFirst: "Select a patient with search before saving the prescription.",
          medicalAlerts: "Medical alerts",
          diagnosis: "Diagnosis",
          notes: "Notes / general instructions",
          drug: "Drug",
          dose: "Dose",
          draftPrintLocked: "Sign the prescription before printing or marking it printed.",
          form: "Form",
          frequency: "Frequency",
          generic: "Generic",
          instructions: "Instructions",
          medicationRows: "Prescription medication rows",
          markPrinted: "Mark printed",
          name: "Name",
          sig: "Sig",
          quantity: "Quantity",
          manual: "Manual",
          manualTemplate: "No template",
          edit: "Edit",
          view: "View",
          print: "Print",
          prescriber: "Prescriber",
          printConfirm: "Mark this prescription as printed?",
          route: "Route",
          addRow: "Add medication row",
          removeRow: "Remove row",
          saveDraft: "Save draft",
          signNow: "Save and sign",
          signNowConfirm: "Save and sign this prescription now? Once signed, it can be officially printed.",
          signConfirm: "Sign this prescription? Once signed, it can be officially printed.",
          metricSigned: "Signed",
          metricTemplates: "Templates",
          library: "Library",
          noSignature: "No signature",
          rxShort: "Rx",
          save: "Save",
          sign: "Sign",
          signature: "Signature",
          strength: "Strength",
          templateShort: "Template",
          warnings: "Warnings",
          commonForm: "Common form",
          indications: "Indications",
          selectedStrength: "Strength / form",
          dispense: "Suggested dispense",
          precautions: "Precautions",
          notesHints: "Notes / hints",
          interactions: "Drug interactions",
          sideEffects: "Side effects",
          viewDetails: "View details",
          tabPrescriptions: "Prescriptions",
          tabMedications: "Medication library",
          tabTemplates: "Prescription templates",
          empty: "No records yet",
        };
  const setPrescriptionRow = (
    rowId: string,
    patch: Partial<PharmacyPrescriptionRow>,
  ) => {
    setPrescriptionRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  };
  const applyMedicationToPrescriptionRow = (
    rowId: string,
    medication: (typeof medications)[number],
  ) => {
    setPrescriptionRow(rowId, {
      medicationId: medication.id,
      medicationQuery: `${medication.code} - ${pharmacyMedicationDisplayName(medication)}`,
      drugName: pharmacyMedicationDisplayName(medication),
      sig: medication.defaultSig ?? "",
    });
    setActiveMedicationSearchRowId(null);
  };
  const applyPrescriptionTemplate = (
    template = selectedPrescriptionTemplate,
  ) => {
    if (!template) {
      return;
    }

    setPrescriptionDiagnosis(template.diagnosis ?? "");
    setPrescriptionNotes(template.instructions ?? "");
    setPrescriptionRows(
      template.items.length > 0
        ? template.items.map((item) => ({
            ...createPharmacyPrescriptionRow(),
            medicationId: item.medicationId ?? "",
            medicationQuery: item.drugName,
            drugName: item.drugName,
            sig: mergePharmacyDirections(item.sig, item.instructions),
            quantity: item.quantity ?? "",
            durationDays: item.durationDays ? String(item.durationDays) : "",
          }))
        : [createPharmacyPrescriptionRow()],
    );
  };
  const resetPrescriptionForm = () => {
    setPrescriptionPatientQuery("");
    setSelectedPrescriptionPatientId("");
    setSelectedPrescriptionTemplateId("");
    setPrescriptionDiagnosis("");
    setPrescriptionNotes("");
    setPrescriptionRows([createPharmacyPrescriptionRow()]);
    setActiveMedicationSearchRowId(null);
  };
  const hasValidPrescriptionRow = prescriptionRows.some((row) => {
    const hasDrug = Boolean(row.medicationId || row.drugName.trim());
    const hasDirections = Boolean(
      row.sig.trim() ||
        row.dose.trim() ||
        row.frequency.trim() ||
        row.route.trim() ||
        row.instructions.trim(),
    );

    return hasDrug && hasDirections;
  });
  const canSubmitPrescription =
    canMutate && Boolean(selectedPrescriptionPatient) && hasValidPrescriptionRow;

  return (
    <section className="view-stack">
      <datalist id="pharmacy-medication-library-options">
        {medications.map((medication) => (
          <option
            key={medication.id}
            value={pharmacyMedicationDisplayName(medication)}
          >
            {medication.code}
          </option>
        ))}
      </datalist>

      <div className="toolbar">
        <div>
          <p className="eyebrow">{language === "vi" ? "Đơn thuốc" : "Rx"}</p>
          <h2>{text.heading}</h2>
        </div>
        <SourceBadge source={pharmacyWorkspace?.source} />
      </div>

      {(pharmacyWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(pharmacyWorkspace?.message, language)}
        </div>
      )}

      <div className="metric-grid">
        <MetricCard label={text.medicationList} value={String(medications.length)} tone="blue" />
        <MetricCard label={text.metricTemplates} value={String(templates.length)} tone="teal" />
        <MetricCard label={text.prescriptionList} value={String(prescriptions.length)} tone="green" />
        <MetricCard
          label={text.metricSigned}
          value={String(prescriptions.filter((item) => item.status === "SIGNED").length)}
          tone="violet"
        />
      </div>

      <div className="segmented pharmacy-section-tabs" role="tablist" aria-label={text.heading}>
        {[
          { key: "prescriptions", label: text.tabPrescriptions },
          { key: "medications", label: text.tabMedications },
          { key: "templates", label: text.tabTemplates },
        ].map((section) => (
          <button
            aria-selected={activePharmacySection === section.key}
            className={activePharmacySection === section.key ? "active" : ""}
            key={section.key}
            onClick={() =>
              setActivePharmacySection(
                section.key as "prescriptions" | "medications" | "templates",
              )
            }
            role="tab"
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      <div className="service-action-row">
        {activePharmacySection === "prescriptions" ? (
          <button
            className="primary-button"
            type="button"
            disabled={!canMutate || patients.length === 0}
            onClick={() => {
              resetPrescriptionForm();
              setPharmacyModal("prescription");
            }}
          >
            <FileText size={16} />
            {text.prescription}
          </button>
        ) : null}
        {activePharmacySection === "templates" ? (
          <button
            className="primary-button"
            type="button"
            disabled={!canMutate}
            onClick={() => setPharmacyModal("template")}
          >
            <ClipboardList size={16} />
            {text.template}
          </button>
        ) : null}
        {activePharmacySection === "medications" ? (
          <button
            className="primary-button"
            type="button"
            disabled={!canMutate}
            onClick={() => setPharmacyModal("medication")}
          >
            <Activity size={16} />
            {text.medication}
          </button>
        ) : null}
      </div>

      {pharmacyModal === "prescription" && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={text.prescription}
          onClick={() => setPharmacyModal(null)}
        >
          <form
            action={createPrescriptionAction}
            className="progress-modal pharmacy-modal pharmacy-prescription-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;

              if (!canSubmitPrescription) {
                event.preventDefault();
                return;
              }

              if (submitter?.value === "sign" && !window.confirm(text.signNowConfirm)) {
                event.preventDefault();
                return;
              }

              setPharmacyModal(null);
            }}
          >
            <div className="progress-modal-header">
              <div>
                <span>{text.rxShort}</span>
                <h3>{text.prescription}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setPharmacyModal(null)} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <input name="patientId" type="hidden" value={selectedPrescriptionPatient?.id ?? ""} />
            <input name="templateId" type="hidden" value={selectedPrescriptionTemplateId} />
            <div className="pharmacy-prescription-builder">
              <section className="pharmacy-prescription-step">
                <div className="pharmacy-prescription-step-header">
                  <span>1</span>
                  <strong>{text.patient}</strong>
                </div>
                <PatientSearchCombobox
                  disabled={!canMutate || patients.length === 0}
                  hideIcon
                  matches={prescriptionPatientSearchMatches}
                  noResultsLabel={text.noPatientResults}
                  onQueryChange={(value) => {
                    setPrescriptionPatientQuery(value);
                    setSelectedPrescriptionPatientId("");
                  }}
                  onSelect={(patient) => {
                    setSelectedPrescriptionPatientId(patient.id);
                    setPrescriptionPatientQuery("");
                  }}
                  placeholder={text.patientSearchPlaceholder}
                  query={prescriptionPatientQuery}
                  selectedPatient={
                    selectedPrescriptionPatient
                      ? {
                          id: selectedPrescriptionPatient.id,
                          name: selectedPrescriptionPatient.name,
                          phone: selectedPrescriptionPatient.phone ?? "-",
                        }
                      : null
                  }
                  selectLabel={text.patient}
                />
                {!selectedPrescriptionPatient ? (
                  <small className="field-helper warning">{text.selectPatientFirst}</small>
                ) : null}
                {selectedPrescriptionPatient?.medicalAlerts.length ? (
                  <div className="schedule-alert">
                    <strong>{text.medicalAlerts}:</strong>{" "}
                    {selectedPrescriptionPatient.medicalAlerts.join(", ")}
                  </div>
                ) : null}
              </section>

              <section className="pharmacy-prescription-step">
                <div className="pharmacy-prescription-step-header">
                  <span>2</span>
                  <strong>{text.templatePreview}</strong>
                </div>
                <div className="pharmacy-template-apply-row">
                  <label>
                    {text.templateShort}
                    <select
                      disabled={!canMutate || templates.length === 0}
                      onChange={(event) => {
                        const templateId = event.target.value;
                        const nextTemplate =
                          templates.find((template) => template.id === templateId) ?? null;

                        setSelectedPrescriptionTemplateId(templateId);

                        if (nextTemplate) {
                          applyPrescriptionTemplate(nextTemplate);
                        }
                      }}
                      value={selectedPrescriptionTemplateId}
                    >
                      <option value="">{text.manualTemplate}</option>
                      {templates.map((template) => (
                        <option value={template.id} key={template.id}>
                          {template.code} - {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canMutate || !selectedPrescriptionTemplate}
                    onClick={() => applyPrescriptionTemplate()}
                  >
                    <ClipboardList size={16} />
                    {text.applyTemplate}
                  </button>
                </div>
                {selectedPrescriptionTemplate ? (
                  <div className="pharmacy-template-preview">
                    <strong>{selectedPrescriptionTemplate.name}</strong>
                    <small>{selectedPrescriptionTemplate.diagnosis ?? "-"}</small>
                    <div>
                      {selectedPrescriptionTemplate.items.map((item) => (
                        <span key={item.id}>
                          {item.drugName}
                          {item.quantity ? ` · ${item.quantity}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="pharmacy-prescription-step">
                <div className="pharmacy-prescription-step-header">
                  <span>3</span>
                  <strong>{text.diagnosis}</strong>
                </div>
                <div className="staff-form modal-form-grid">
                  <label>
                    {text.diagnosis}
                    <input
                      name="diagnosis"
                      disabled={!canMutate}
                      onChange={(event) => setPrescriptionDiagnosis(event.target.value)}
                      value={prescriptionDiagnosis}
                    />
                  </label>
                  <label>
                    {text.notes}
                    <input
                      name="notes"
                      disabled={!canMutate}
                      onChange={(event) => setPrescriptionNotes(event.target.value)}
                      value={prescriptionNotes}
                    />
                  </label>
                </div>
              </section>

              <section className="pharmacy-prescription-step">
                <div className="pharmacy-prescription-step-header">
                  <span>4</span>
                  <strong>{text.medicationRows}</strong>
                </div>
                <div className="pharmacy-rx-row-list">
                  {prescriptionRows.map((row, index) => {
                    const medicationQuery = normalizeSearchText(row.medicationQuery);
                    const medicationMatches = medicationQuery
                      ? medications
                          .filter((medication) =>
                            normalizeSearchText(
                              `${medication.code} ${pharmacyMedicationDisplayName(medication)} ${medication.form ?? ""}`,
                            ).includes(medicationQuery),
                          )
                          .slice(0, 6)
                      : [];

                    return (
                      <article className="pharmacy-rx-row" key={row.id}>
                        <div className="pharmacy-rx-row-head">
                          <span>{index + 1}</span>
                          <label>
                            <input
                              disabled={!canMutate}
                              onBlur={() => setActiveMedicationSearchRowId(null)}
                              onChange={(event) => {
                                setPrescriptionRow(row.id, {
                                  medicationId: "",
                                  medicationQuery: event.target.value,
                                  drugName: event.target.value,
                                });
                                setActiveMedicationSearchRowId(row.id);
                              }}
                              onFocus={() => setActiveMedicationSearchRowId(row.id)}
                              placeholder={text.customDrug}
                              value={row.medicationQuery || row.drugName}
                            />
                            <input name="medicationId" type="hidden" value={row.medicationId} />
                            <input name="drugName" type="hidden" value={row.drugName} />
                            {activeMedicationSearchRowId === row.id && medicationQuery ? (
                              <div className="pharmacy-medication-results">
                                {medicationMatches.length > 0 ? (
                                  medicationMatches.map((medication) => (
                                    <button
                                      key={medication.id}
                                      type="button"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => applyMedicationToPrescriptionRow(row.id, medication)}
                                    >
                                      <strong>{medication.code}</strong>
                                      <span>{pharmacyMedicationDisplayName(medication)}</span>
                                    </button>
                                  ))
                                ) : (
                                  <div>{text.empty}</div>
                                )}
                              </div>
                            ) : null}
                          </label>
                          <input
                            aria-label={text.quantity}
                            className="pharmacy-rx-quantity-input"
                            name="quantity"
                            placeholder={text.quantity}
                            value={row.quantity}
                            disabled={!canMutate}
                            onChange={(event) =>
                              setPrescriptionRow(row.id, { quantity: event.target.value })
                            }
                          />
                          <button
                            className="icon-button small"
                            type="button"
                            disabled={!canMutate || prescriptionRows.length === 1}
                            onClick={() =>
                              setPrescriptionRows((rows) => rows.filter((item) => item.id !== row.id))
                            }
                            aria-label={text.removeRow}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="pharmacy-rx-row-grid">
                          <label className="clinical-wide">
                            {text.sig}
                            <textarea name="sig" value={row.sig} disabled={!canMutate} onChange={(event) => setPrescriptionRow(row.id, { sig: event.target.value })} />
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!canMutate}
                  onClick={() => setPrescriptionRows((rows) => [...rows, createPharmacyPrescriptionRow()])}
                >
                  <Activity size={16} />
                  {text.addRow}
                </button>
              </section>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPharmacyModal(null)}>
                {text.cancel}
              </button>
              <button className="secondary-button" type="submit" name="intent" value="draft" disabled={!canSubmitPrescription}>
                <FileText size={16} />
                {text.saveDraft}
              </button>
              <button className="primary-button" type="submit" name="intent" value="sign" disabled={!canSubmitPrescription}>
                <CheckCircle2 size={16} />
                {text.signNow}
              </button>
            </div>
          </form>
        </div>
      )}

      {pharmacyModal === "template" && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.template} onClick={() => setPharmacyModal(null)}>
          <form action={createPrescriptionTemplateAction} className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setPharmacyModal(null)}>
            <div className="progress-modal-header">
              <div>
                <span>{text.templateShort}</span>
                <h3>{text.template}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setPharmacyModal(null)} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form modal-form-grid">
              <label>
                {text.code}
                <input name="code" placeholder="ENDO" disabled={!canMutate} required />
              </label>
              <label>
                {text.name}
                <input name="name" disabled={!canMutate} required />
              </label>
              <label>
                {text.diagnosis}
                <input name="diagnosis" disabled={!canMutate} />
              </label>
              <label>
                {text.drug}
                <input
                  name="drugName"
                  list="pharmacy-medication-library-options"
                  placeholder={text.customDrug}
                  disabled={!canMutate}
                  required
                />
              </label>
              <label>
                {text.sig}
                <input name="sig" disabled={!canMutate} required />
              </label>
              <label>
                {text.quantity}
                <input name="quantity" disabled={!canMutate} />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPharmacyModal(null)}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate}>
                <ClipboardList size={16} />
                {text.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {pharmacyModal === "medication" && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.medication} onClick={() => setPharmacyModal(null)}>
          <form action={createMedicationAction} className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setPharmacyModal(null)}>
            <div className="progress-modal-header">
              <div>
                <span>{text.medicationList}</span>
                <h3>{text.medication}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setPharmacyModal(null)} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form modal-form-grid">
              <label>
                {text.code}
                <input name="code" placeholder="AMOX500" disabled={!canMutate} required />
              </label>
              <label>
                {text.generic}
                <input name="genericName" placeholder="Paracetamol" disabled={!canMutate} required />
              </label>
              <label>
                {text.brand}
                <input name="brandName" placeholder="Efferalgan" disabled={!canMutate} />
              </label>
              <label>
                {text.strength}
                <input name="strength" placeholder="500mg" disabled={!canMutate} />
              </label>
              <label>
                {text.form}
                <input name="form" placeholder="Viên nén" disabled={!canMutate} />
              </label>
              <label>
                {text.route}
                <input name="route" placeholder={language === "vi" ? "Uống" : "Oral"} disabled={!canMutate} />
              </label>
              <label>
                {text.frequency}
                <input name="frequency" placeholder={language === "vi" ? "Mỗi 8 giờ" : "Every 8 hours"} disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {text.sig}
                <textarea name="defaultSig" disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {text.warnings}
                <textarea name="warnings" disabled={!canMutate} />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPharmacyModal(null)}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate}>
                <Activity size={16} />
                {text.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingMedication && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={pharmacyMedicationDisplayName(editingMedication)} onClick={() => setEditingMedicationId("")}>
          <form action={createMedicationAction} className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setEditingMedicationId("")}>
            <div className="progress-modal-header">
              <div>
                <span>{editingMedication.code}</span>
                <h3>{pharmacyMedicationDisplayName(editingMedication)}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setEditingMedicationId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form modal-form-grid">
              <label>
                {text.code}
                <input name="code" defaultValue={editingMedication.code} readOnly required />
              </label>
              <label>
                {text.generic}
                <input name="genericName" defaultValue={editingMedication.genericName} disabled={!canMutate} required />
              </label>
              <label>
                {text.brand}
                <input name="brandName" defaultValue={editingMedication.brandName ?? ""} disabled={!canMutate} />
              </label>
              <label>
                {text.strength}
                <input name="strength" defaultValue={editingMedication.strength ?? ""} disabled={!canMutate} />
              </label>
              <label>
                {text.form}
                <input name="form" defaultValue={editingMedication.form ?? ""} disabled={!canMutate} />
              </label>
              <label>
                {text.route}
                <input name="route" defaultValue={editingMedication.route ?? ""} disabled={!canMutate} />
              </label>
              <label>
                {text.frequency}
                <input name="frequency" defaultValue={editingMedication.frequency ?? ""} disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {text.sig}
                <textarea name="defaultSig" defaultValue={editingMedication.defaultSig ?? ""} disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {text.warnings}
                <textarea name="warnings" defaultValue={editingMedication.warnings.join(", ")} disabled={!canMutate} />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditingMedicationId("")}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate}>
                <Activity size={16} />
                {text.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingTemplate && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={editingTemplate.name} onClick={() => setEditingTemplateId("")}>
          <form action={createPrescriptionTemplateAction} className="progress-modal pharmacy-modal pharmacy-template-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setEditingTemplateId("")}>
            <div className="progress-modal-header">
              <div>
                <span>{editingTemplate.code}</span>
                <h3>{editingTemplate.name}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setEditingTemplateId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form modal-form-grid">
              <label>
                {text.code}
                <input name="code" defaultValue={editingTemplate.code} readOnly required />
              </label>
              <label>
                {text.name}
                <input name="name" defaultValue={editingTemplate.name} disabled={!canMutate} required />
              </label>
              <label>
                {text.diagnosis}
                <input name="diagnosis" defaultValue={editingTemplate.diagnosis ?? ""} disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {text.instructions}
                <textarea name="instructions" defaultValue={editingTemplate.instructions ?? ""} disabled={!canMutate} />
              </label>
            </div>
            <div className="pharmacy-template-items">
              {editingTemplate.items.map((item, index) => (
                <div className="pharmacy-template-item" key={item.id}>
                  <div className="pharmacy-template-item-head">
                    <span>{index + 1}</span>
                    <input
                      name="drugName"
                      defaultValue={item.drugName}
                      list="pharmacy-medication-library-options"
                      placeholder={text.customDrug}
                      disabled={!canMutate}
                    />
                    <input name="quantity" defaultValue={item.quantity ?? ""} placeholder={text.quantity} disabled={!canMutate} />
                  </div>
                  <label>
                    {text.sig}
                    <textarea
                      name="sig"
                      defaultValue={mergePharmacyDirections(item.sig, item.instructions)}
                      placeholder={
                        language === "vi"
                          ? "Mỗi lần uống 1 viên, ngày uống 2 lần vào buổi sáng và buổi tối sau ăn. Uống sau ăn, uống nhiều nước, dùng đủ số ngày được kê..."
                          : "Take 1 tablet each time, twice daily in the morning and evening after meals. Take after food, with water, and complete the prescribed course..."
                      }
                      disabled={!canMutate}
                      required
                    />
                  </label>
                </div>
              ))}
              <div className="pharmacy-template-item">
                <div className="pharmacy-template-item-head">
                  <span>+</span>
                  <input
                    name="drugName"
                    list="pharmacy-medication-library-options"
                    placeholder={text.addItemIfNeeded}
                    disabled={!canMutate}
                  />
                  <input name="quantity" placeholder={text.quantity} disabled={!canMutate} />
                </div>
                <label>
                  {text.sig}
                  <textarea
                    name="sig"
                    placeholder={
                      language === "vi"
                        ? "Mỗi lần uống 1 viên, ngày uống 2 lần vào buổi sáng và buổi tối sau ăn. Uống sau ăn, uống nhiều nước, dùng đủ số ngày được kê..."
                        : "Take 1 tablet each time, twice daily in the morning and evening after meals. Take after food, with water, and complete the prescribed course..."
                    }
                    disabled={!canMutate}
                  />
                </label>
              </div>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditingTemplateId("")}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate}>
                <ClipboardList size={16} />
                {text.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {printingTemplate && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={`${text.print} ${printingTemplate.name}`} onClick={() => setPrintingTemplateId("")}>
          <div className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()}>
            <div className="progress-modal-header">
              <div>
                <span>{printingTemplate.code}</span>
                <h3>{text.print} {printingTemplate.name}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setPrintingTemplateId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form">
              <label>
                {text.patient}
                <select
                  value={printPatientId}
                  onChange={(event) => setPrintPatientId(event.target.value)}
                >
                  <option value="">
                    {language === "vi"
                      ? "Không chọn bệnh nhân - để trống thông tin"
                      : "No patient - leave patient fields blank"}
                  </option>
                  {patients.map((patient) => (
                    <option value={patient.id} key={patient.id}>
                      {patient.name} - {patient.phone ?? "-"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="progress-modal-note">
              {language === "vi"
                ? "Nếu không chọn bệnh nhân, vùng họ tên, tuổi, điện thoại, chẩn đoán và địa chỉ sẽ để trống khi in."
                : "If no patient is selected, patient name, age, phone, diagnosis, and address will be left blank on print."}
            </p>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPrintingTemplateId("")}>
                {text.cancel}
              </button>
              <Link
                className="primary-button"
                href={`/pharmacy/template-print/${encodeURIComponent(printingTemplate.id)}${
                  printPatientId ? `?patientId=${encodeURIComponent(printPatientId)}` : ""
                }`}
                target="_blank"
                onClick={() => setPrintingTemplateId("")}
              >
                <Printer size={16} />
                {text.print}
              </Link>
            </div>
          </div>
        </div>
      )}

      {activePharmacySection === "prescriptions" ? (
        <section className="panel">
          <PanelHeader icon={FileText} title={text.prescriptionList} action={`${prescriptions.length}`} />
          <div className="invoice-list">
            {prescriptions.length > 0 ? (
              prescriptions.map((prescription) => (
                <details className="pharmacy-prescription-card" key={prescription.id}>
                  <summary className="pharmacy-prescription-summary">
                    <div>
                      <strong>{prescription.prescriptionNo}</strong>
                      <span>
                        {prescription.patientName} · {prescription.items.length} {text.drug}
                      </span>
                      <small>
                        {text.createdAt}: {prescription.createdAt} · {text.prescriber}:{" "}
                        {prescription.prescriberName}
                      </small>
                    </div>
                    <StatusPill status={prescription.status} />
                    <span className="pharmacy-medication-card-toggle">{text.viewDetails}</span>
                  </summary>
                  <div className="pharmacy-prescription-card-body">
                    <div className="pharmacy-prescription-items">
                      {prescription.items.map((item) => (
                        <span className="pharmacy-prescription-item" key={item.id}>
                          <strong>{item.drugName}</strong>
                          {item.quantity ? ` · ${item.quantity}` : ""} · {item.sig}
                        </span>
                      ))}
                    </div>
                    <div className="invoice-actions pharmacy-prescription-actions">
                      <button type="button" onClick={() => setViewingPrescriptionId(prescription.id)}>
                        {text.view}
                      </button>
                      {prescription.status === "DRAFT" && (
                        <form
                          action={signPrescriptionAction}
                          onSubmit={(event) => {
                            if (!window.confirm(text.signConfirm)) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input name="prescriptionId" type="hidden" value={prescription.id} />
                          <button type="submit" disabled={!canMutate}>
                            {text.sign}
                          </button>
                        </form>
                      )}
                      {prescription.status === "SIGNED" ? (
                        <>
                          <form
                            action={markPrescriptionPrintedAction}
                            onSubmit={(event) => {
                              if (!window.confirm(text.printConfirm)) {
                                event.preventDefault();
                              }
                            }}
                          >
                            <input name="prescriptionId" type="hidden" value={prescription.id} />
                            <button type="submit" disabled={!canMutate}>
                              <Printer size={13} aria-hidden="true" />
                              {text.markPrinted}
                            </button>
                          </form>
                          <Link href={`/pharmacy/print/${encodeURIComponent(prescription.prescriptionNo)}`}>
                            <Printer size={13} aria-hidden="true" />
                            {text.print}
                          </Link>
                        </>
                      ) : (
                        <span className="pharmacy-action-note">{text.draftPrintLocked}</span>
                      )}
                    </div>
                  </div>
                </details>
              ))
            ) : (
              <EmptyState label={text.empty} />
            )}
          </div>
        </section>
      ) : null}

      {activePharmacySection === "medications" ? (
        <section className="panel">
          <PanelHeader icon={FileText} title={text.medicationList} action={`${medications.length}`} />
          <div className="pharmacy-group-list">
            {medicationGroups.length > 0 ? (
              medicationGroups.map((group) => (
                <div className="pharmacy-group" key={group.name}>
                  <div className="pharmacy-group-title">
                    <strong>{group.name}</strong>
                    <span>{group.items.length}</span>
                  </div>
                  <div className="pharmacy-medication-card-list">
                    {group.items.map((medication) => {
                      const notes = pharmacyMedicationNotes(medication, language);

                      return (
                        <details className="pharmacy-medication-card" key={medication.id}>
                          <summary className="pharmacy-medication-card-summary">
                            <div>
                              <span>{medication.code}</span>
                              <h3>{pharmacyMedicationDisplayName(medication)}</h3>
                              <p>
                                {[
                                  medication.genericName,
                                  medication.brandName ? `${text.brand}: ${medication.brandName}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <div className="pharmacy-medication-card-form">
                              <small>{text.commonForm}</small>
                              <strong>{medication.form ?? "-"}</strong>
                            </div>
                            <span className="pharmacy-medication-card-toggle">{text.viewDetails}</span>
                          </summary>
                          <button
                            className="icon-button small pharmacy-card-edit"
                            type="button"
                            disabled={!canMutate}
                            onClick={() => setEditingMedicationId(medication.id)}
                            aria-label={`${text.edit} ${pharmacyMedicationDisplayName(medication)}`}
                          >
                            <Settings size={15} />
                          </button>
                          <div className="pharmacy-medication-card-body">
                            <div className="pharmacy-medication-indication">
                              <span>{text.indications}</span>
                              <strong>{pharmacyMedicationIndication(medication, language)}</strong>
                            </div>
                            <div className="pharmacy-medication-strength">
                              <strong>{medication.strength ?? medication.form ?? "-"}</strong>
                              <span>{text.selectedStrength}</span>
                            </div>
                            <div className="pharmacy-medication-facts">
                              <div>
                                <span>{text.dose}</span>
                                <strong>{medication.defaultDose ?? "-"}</strong>
                              </div>
                              <div>
                                <span>{text.dispense}</span>
                                <strong>{pharmacyMedicationDispenseHint(medication)}</strong>
                              </div>
                              <div>
                                <span>{text.route}</span>
                                <strong>{medication.route ?? "-"}</strong>
                              </div>
                              <div>
                                <span>{text.frequency}</span>
                                <strong>{medication.frequency ?? "-"}</strong>
                              </div>
                            </div>
                            <div className="pharmacy-medication-directions">
                              <strong>{text.sig}</strong>
                              <p>{medication.defaultSig ?? "-"}</p>
                            </div>
                            {medication.warnings.length > 0 ? (
                              <div className="pharmacy-medication-warning">
                                <strong>{text.precautions}</strong>
                                <ul>
                                  {medication.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            <div className="pharmacy-medication-notes">
                              <strong>{text.notesHints}</strong>
                              <ul>
                                {notes.map((note) => (
                                  <li key={note}>{note}</li>
                                ))}
                              </ul>
                            </div>
                            <details className="pharmacy-medication-more">
                              <summary>{text.interactions}</summary>
                              <p>{pharmacyMedicationInteractions(medication, language)}</p>
                            </details>
                            <details className="pharmacy-medication-more">
                              <summary>{text.sideEffects}</summary>
                              <p>{pharmacyMedicationSideEffects(medication, language)}</p>
                            </details>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState label={text.empty} />
            )}
          </div>
        </section>
      ) : null}

      {activePharmacySection === "templates" ? (
        <section className="panel">
          <PanelHeader icon={ClipboardList} title={text.templateList} action={`${templates.length}`} />
          <div className="record-grid">
            {templates.length > 0 ? (
              templates.map((template) => (
                <article className="record-tile pharmacy-edit-tile pharmacy-template-card" key={template.id}>
                  <button
                    className="icon-button small pharmacy-card-print"
                    type="button"
                    onClick={() => {
                      setPrintingTemplateId(template.id);
                      setPrintPatientId("");
                    }}
                    aria-label={`${text.print} ${template.name}`}
                  >
                    <Printer size={15} />
                  </button>
                  <button
                    className="icon-button small pharmacy-card-edit"
                    type="button"
                    disabled={!canMutate}
                    onClick={() => setEditingTemplateId(template.id)}
                    aria-label={`${text.edit} ${template.name}`}
                  >
                    <Settings size={15} />
                  </button>
                  <span>{template.code}</span>
                  <strong>{template.name}</strong>
                  <small>{template.items.map((item) => item.drugName).join(" · ")}</small>
                </article>
              ))
            ) : (
              <EmptyState label={text.empty} />
            )}
          </div>
        </section>
      ) : null}

      {viewingPrescription && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={viewingPrescription.prescriptionNo} onClick={() => setViewingPrescriptionId("")}>
          <div className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()}>
            <div className="progress-modal-header">
              <div>
                <span>{viewingPrescription.prescriptionNo}</span>
                <h3>{viewingPrescription.patientName}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setViewingPrescriptionId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="pharmacy-detail-grid">
              <div>
                <span>{text.createdAt}</span>
                <strong>{viewingPrescription.createdAt}</strong>
              </div>
              <div>
                <span>{text.prescriber}</span>
                <strong>{viewingPrescription.prescriberName}</strong>
              </div>
              <div>
                <span>{text.signature}</span>
                <strong>{viewingPrescription.signedAt ?? "-"}</strong>
              </div>
              <div>
                <span>{text.print}</span>
                <strong>{viewingPrescription.printedAt ?? "-"}</strong>
              </div>
            </div>
            <div className="pharmacy-detail-note">
              <strong>{text.diagnosis}</strong>
              <p>{viewingPrescription.diagnosis ?? "-"}</p>
              {viewingPrescription.notes ? <p>{viewingPrescription.notes}</p> : null}
            </div>
            <div className="pharmacy-detail-items">
              {viewingPrescription.items.map((item, index) => (
                <article className="pharmacy-template-item" key={item.id}>
                  <div className="pharmacy-template-item-head">
                    <span>{index + 1}</span>
                    <strong>{item.drugName}</strong>
                    <small>{item.quantity ?? "-"}</small>
                    <small>{item.durationDays ? `${item.durationDays} ${text.days}` : "-"}</small>
                    <small>{item.strength ?? ""}</small>
                  </div>
                  <p>{item.sig}</p>
                  {item.instructions ? <small>{item.instructions}</small> : null}
                </article>
              ))}
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setViewingPrescriptionId("")}>
                {text.close}
              </button>
              {viewingPrescription.status === "SIGNED" ? (
                <Link className="primary-button" href={`/pharmacy/print/${encodeURIComponent(viewingPrescription.prescriptionNo)}`}>
                  <Printer size={16} />
                  {text.print}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
