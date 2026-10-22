"use client";
import { buildJourneyTimeline } from "./journey-timeline";
import { FileText, } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { useAppLanguage } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { serviceAppliedAmount as calculateServiceAppliedAmount } from "@/lib/billing-calculations";
import { type Appointment, type Clinic, type Invoice, type Patient, type TreatmentPlan } from "@/lib/data";
import { hasAnyRole } from "@/lib/permissions";
import type { BillingWorkspace } from "@/lib/billing-types";
import type { ClinicalWorkspace as ClinicalWorkspaceData } from "@/lib/clinical-types";
import type { CrmWorkspace } from "@/lib/crm-types";
import type { FormsWorkspace } from "@/lib/forms-types";
import type { JourneyRecordsWorkspace } from "@/lib/journey-records-types";
import { journeyTimelineTimestamp } from "@/lib/journey-timeline";
import type { PatientFilesWorkspace } from "@/lib/patient-files-types";
import type { PatientWorkspace } from "@/lib/patient-types";
import type { PharmacyWorkspace } from "@/lib/pharmacy-types";
import type { ScheduleWorkspace } from "@/lib/schedule-types";
import type { ServicesWorkspace } from "@/lib/services-types";
import type { AppSession } from "@/lib/session";
import type { StaffDirectoryMember } from "@/lib/staff-directory";
import type { TreatmentWorkspace } from "@/lib/treatment-types";
import { serviceCatalog as serviceLibrary } from "@/lib/service-catalog";
import { formatFileSize, timelineFileKindLabel, useNoticeText, invoiceBalance, isCollectableInvoice, JourneyReceipt, JourneyCreditAllocation, isArchTarget, isToothTarget, serviceTargetsFromSelection, patientCodeFor, patientClassCodeFor, serviceProgressOptions, serviceProgressLabelFromPercent, PendingProgressUpdate, JourneyServiceRow, JourneyServiceCatalogOption, serviceCatalogOptionName, nextServiceSequence, createServiceInstanceCode, displayServiceInstanceCode, JourneyTreatmentDraft, JourneyTreatmentDraftStore, JourneyComment, JourneyTimelineAttachment, JourneyTimelineEvent, groupJourneyTimelineEvents, JourneyTimelineFilter, journeyText, normalizeSearchText, matchesChartSearch, splitClinicalObjective } from "./journey-shared";
export function usePatientJourneyPanelModel({ actorName, billingWorkspace, clinicalWorkspace, crmWorkspace, formsWorkspace, journeyRecordsWorkspace, patientFilesWorkspace, patientWorkspace, pharmacyWorkspace, scheduleWorkspace, servicesWorkspace, staffDirectory, session, treatmentWorkspace, chartSearch, journeyReceipts, selectedPatientId, visibleAppointments, visibleClinics, visibleInvoices, visiblePatients, visiblePlans, }: {
    actorName: string;
    billingWorkspace?: BillingWorkspace | null;
    clinicalWorkspace?: ClinicalWorkspaceData | null;
    crmWorkspace?: CrmWorkspace | null;
    formsWorkspace?: FormsWorkspace | null;
    journeyRecordsWorkspace?: JourneyRecordsWorkspace | null;
    patientFilesWorkspace?: PatientFilesWorkspace | null;
    patientWorkspace?: PatientWorkspace | null;
    pharmacyWorkspace?: PharmacyWorkspace | null;
    scheduleWorkspace?: ScheduleWorkspace | null;
    servicesWorkspace?: ServicesWorkspace | null;
    staffDirectory?: StaffDirectoryMember[];
    session: AppSession;
    treatmentWorkspace?: TreatmentWorkspace | null;
    chartSearch: string;
    journeyReceipts: JourneyReceipt[];
    selectedPatientId: string;
    visibleAppointments: Appointment[];
    visibleClinics: Clinic[];
    visibleInvoices: Invoice[];
    visiblePatients: Patient[];
    visiblePlans: TreatmentPlan[];
}) {
    const { language } = useAppLanguage();
    const jt = journeyText[language];
    const searchParams = useSearchParams();
    const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
    const selectedPatient = visiblePatients.find((patient) => patient.id === selectedPatientId) ?? null;
    const visiblePatientsById = useMemo(() => new Map(visiblePatients.map((patient) => [patient.id, patient])), [visiblePatients]);
    const selectedPatientKey = selectedPatient?.id ?? "";
    const chartSearchQuery = normalizeSearchText(chartSearch.trim());
    const serviceOptions = useMemo<JourneyServiceCatalogOption[]>(() => {
        const databaseServices = servicesWorkspace?.services
            .filter((service) => service.status === "ACTIVE")
            .map((service) => ({
            id: service.id,
            code: service.code,
            category: service.categoryCode,
            name: service.name,
            nameEn: service.nameEn ?? service.name,
            price: service.defaultPrice,
            compensationRuleId: service.defaultCompensationRuleId,
            compensationRuleName: service.defaultCompensationRuleName,
        })) ?? [];
        if (servicesWorkspace?.source === "database") {
            return databaseServices;
        }
        return serviceLibrary.map((service) => ({
            ...service,
            compensationRuleId: null,
            compensationRuleName: null,
        }));
    }, [servicesWorkspace?.services, servicesWorkspace?.source]);
    const patientSearchMatches = visiblePatients.filter((patient) => matchesChartSearch(chartSearchQuery, [
        patient.name,
        patient.phone,
        patientCodeFor(patient),
        patientClassCodeFor(patient),
        patient.email,
        patient.nationalId,
        patient.address,
        patient.city,
        patient.guardianName,
        patient.consent,
        ...patient.flags,
    ]));
    const [selectedTeeth, setSelectedTeeth] = useState<string[]>([]);
    const [odontogramDiagnosis, setOdontogramDiagnosis] = useState<string>(jt.odontogram.diagnosisDefault);
    const [selectedServiceId, setSelectedServiceId] = useState("");
    const [plannedServices, setPlannedServices] = useState<JourneyServiceRow[]>([]);
    const [treatmentDrafts, setTreatmentDrafts] = useState<JourneyTreatmentDraftStore>({});
    const [timelineComments] = useState<JourneyComment[]>([]);
    const [timelineFilter, setTimelineFilter] = useState<JourneyTimelineFilter>("All");
    const [commentBody, setCommentBody] = useState("");
    const [commentAttachments, setCommentAttachments] = useState<JourneyTimelineAttachment[]>([]);
    const [, setCommentImage] = useState<{
        name: string;
        url: string;
    } | null>(null);
    const [openTimelineImage, setOpenTimelineImage] = useState<{
        alt: string;
        src: string;
    } | null>(null);
    const [pendingProgressUpdate, setPendingProgressUpdate] = useState<PendingProgressUpdate | null>(null);
    const [journeyCreditAllocations] = useState<JourneyCreditAllocation[]>([]);
    const journeyDatabaseOnly = [
        patientWorkspace?.source,
        clinicalWorkspace?.source,
        treatmentWorkspace?.source,
        scheduleWorkspace?.source,
        billingWorkspace?.source,
        servicesWorkspace?.source,
        pharmacyWorkspace?.source,
        formsWorkspace?.source,
        patientFilesWorkspace?.source,
        journeyRecordsWorkspace?.source,
        crmWorkspace?.source,
    ].includes("database");
    useEffect(() => {
        setPendingProgressUpdate(null);
    }, [chartSearch, selectedPatientId]);
    useEffect(() => {
        if (selectedServiceId && !serviceOptions.some((service) => service.id === selectedServiceId)) {
            setSelectedServiceId("");
        }
    }, [selectedServiceId, serviceOptions]);
    useEffect(() => {
        setOdontogramDiagnosis((current) => current === journeyText.vi.odontogram.diagnosisDefault ||
            current === journeyText.en.odontogram.diagnosisDefault
            ? jt.odontogram.diagnosisDefault
            : current);
    }, [language, jt.odontogram.diagnosisDefault]);
    const selectedNotes = clinicalWorkspace?.notes.filter((note) => note.patientId === selectedPatientKey) ??
        [];
    const selectedPlans = visiblePlans.filter((plan) => plan.patientId === selectedPatientKey);
    const selectedInvoices = visibleInvoices.filter((invoice) => invoice.patientId === selectedPatientKey);
    const selectedBillingReceipts = billingWorkspace?.receipts.filter((receipt) => receipt.patientId === selectedPatientKey) ?? [];
    const selectedPrescriptions = pharmacyWorkspace?.prescriptions.filter((prescription) => prescription.patientId === selectedPatientKey) ?? [];
    const selectedPatientForms = formsWorkspace?.patientForms.filter((form) => form.patientId === selectedPatientKey) ??
        [];
    const selectedPatientFiles = patientFilesWorkspace?.files.filter((file) => file.patientId === selectedPatientKey) ??
        [];
    const selectedJourneyState = journeyRecordsWorkspace?.states.find((state) => state.patientId === selectedPatientKey) ??
        null;
    const selectedOdontogram = journeyRecordsWorkspace?.odontograms.find((odontogram) => odontogram.patientId === selectedPatientKey) ?? null;
    const selectedJourneyComments = journeyRecordsWorkspace?.comments.filter((comment) => comment.patientId === selectedPatientKey) ?? [];
    useEffect(() => {
        setSelectedTeeth(selectedJourneyState?.odontogramTeeth ?? []);
    }, [selectedJourneyState?.id, selectedPatientKey]);
    const selectedCrmActivities = crmWorkspace?.activities.filter((activity) => activity.patientId === selectedPatientKey) ??
        [];
    const selectedAppointments = visibleAppointments.filter((appointment) => appointment.patientId === selectedPatientKey ||
        (selectedPatient && appointment.patient === selectedPatient.name));
    const selectedTreatmentDraft = treatmentDrafts[selectedPatientKey] ?? {
        goal: "",
        plan: "",
    };
    const selectedTreatmentGoal = selectedJourneyState?.treatmentGoal ?? selectedTreatmentDraft.goal;
    const selectedTreatmentPlanText = selectedJourneyState?.treatmentPlan ?? selectedTreatmentDraft.plan;
    const updateTreatmentDraft = (field: keyof JourneyTreatmentDraft, value: string) => {
        if (!selectedPatientKey) {
            return;
        }
        setTreatmentDrafts((current) => ({
            ...current,
            [selectedPatientKey]: {
                goal: current[selectedPatientKey]?.goal ?? "",
                plan: current[selectedPatientKey]?.plan ?? "",
                [field]: value,
            },
        }));
    };
    const latestNote = selectedNotes[0];
    const latestExamFields = splitClinicalObjective(latestNote?.objective);
    const clinicName = visibleClinics.find((clinic) => clinic.id === selectedPatient?.clinicId)?.name ??
        selectedPatient?.city ??
        jt.admin.noClinic;
    const messages = Array.from(new Set([
        patientWorkspace?.message,
        clinicalWorkspace?.message,
        treatmentWorkspace?.message,
        scheduleWorkspace?.message,
        billingWorkspace?.message,
        servicesWorkspace?.message,
        pharmacyWorkspace?.message,
        formsWorkspace?.message,
        patientFilesWorkspace?.message,
        journeyRecordsWorkspace?.message,
        crmWorkspace?.message,
    ].filter(Boolean) as string[]));
    const clinicalReady = Boolean(clinicalWorkspace?.canMutate && selectedPatient);
    const journeyRecordsReady = Boolean(journeyRecordsWorkspace?.canMutate && selectedPatient);
    const canEditTreatmentPlan = hasAnyRole(session, [
        "OWNER",
        "AREA_MANAGER",
        "CLINIC_MANAGER",
        "DENTIST",
    ]);
    const odontogramReady = Boolean(journeyRecordsWorkspace?.source === "database" &&
        selectedPatient &&
        hasAnyRole(session, [
            "OWNER",
            "AREA_MANAGER",
            "CLINIC_MANAGER",
            "DENTIST",
            "HYGIENIST",
        ]));
    const unfinishedClinicalNotes = selectedNotes
        .filter((note) => !note.lockedAt)
        .sort((left, right) => journeyTimelineTimestamp(left.createdAtIso ?? left.createdAt) -
        journeyTimelineTimestamp(right.createdAtIso ?? right.createdAt));
    const canCompleteClinicalNotes = hasAnyRole(session, [
        "OWNER",
        "AREA_MANAGER",
        "CLINIC_MANAGER",
        "DENTIST",
        "HYGIENIST",
    ]);
    const journeyServiceDatabaseReady = servicesWorkspace?.source === "database" && serviceOptions.length > 0;
    const canDeleteTreatmentServices = hasAnyRole(session, ["OWNER"]);
    const selectedLibraryService = serviceOptions.find((service) => service.id === selectedServiceId) ?? null;
    const progressParticipants = staffDirectory?.filter((member) => member.active &&
        member.roleAssignments.some((assignment) => assignment.active &&
            assignment.role !== "PATIENT" &&
            (assignment.clinicId === null ||
                assignment.clinicId === pendingProgressUpdate?.clinicId))) ?? [];
    const selectedToothTargets = selectedTeeth.filter(isToothTarget);
    const selectedArchTargets = selectedTeeth.filter(isArchTarget);
    const selectedServiceTargets = serviceTargetsFromSelection(selectedTeeth, language);
    const updateSelectedToothTargets = (teeth: string[]) => {
        setSelectedTeeth((current) => [...current.filter(isArchTarget), ...teeth]);
    };
    const toggleArchTarget = (targetId: string) => {
        setSelectedTeeth((current) => {
            const toothTargets = current.filter(isToothTarget);
            const currentArchTargets = current.filter(isArchTarget);
            const alreadySelected = currentArchTargets.includes(targetId);
            if (alreadySelected) {
                return [
                    ...toothTargets,
                    ...currentArchTargets.filter((target) => target !== targetId),
                ];
            }
            if (targetId === "TOOTH_GROUP") {
                return [...toothTargets, targetId];
            }
            if (targetId === "ARCH_BOTH") {
                return [...toothTargets, targetId];
            }
            return [
                ...toothTargets,
                ...currentArchTargets.filter((target) => target !== "ARCH_BOTH" && target !== "TOOTH_GROUP"),
                targetId,
            ];
        });
    };
    const addServicesFromOdontogram = () => {
        if (!selectedPatient || !selectedLibraryService || selectedServiceTargets.length === 0) {
            return;
        }
        const createdAt = Date.now();
        const diagnosis = odontogramDiagnosis.trim() || jt.odontogram.missingDiagnosis;
        setPlannedServices((current) => {
            const firstSequence = nextServiceSequence(current, selectedPatient.id, selectedLibraryService.code);
            return [
                ...current,
                ...selectedServiceTargets.map((target, index) => ({
                    id: `${selectedPatient.id}-${selectedLibraryService.id}-${target}-${createdAt}-${index}`,
                    patientId: selectedPatient.id,
                    catalogItemId: selectedLibraryService.id,
                    serviceCode: createServiceInstanceCode(selectedPatient, selectedLibraryService.code, firstSequence + index),
                    catalogCode: selectedLibraryService.code,
                    createdAt,
                    createdBy: actorName,
                    createdById: "",
                    compensationRuleId: selectedLibraryService.compensationRuleId ?? null,
                    compensationRuleName: selectedLibraryService.compensationRuleName ?? null,
                    object: target,
                    diagnosis,
                    serviceName: serviceCatalogOptionName(selectedLibraryService, language),
                    progress: serviceProgressOptions[0],
                    listPrice: selectedLibraryService.price,
                    discount: 0,
                    finalPrice: selectedLibraryService.price,
                    patientRequestedInvoice: false,
                    source: "odontogram" as const,
                })),
            ];
        });
        setSelectedTeeth([]);
    };
    const selectedReceipts = journeyReceipts.filter((receipt) => receipt.patientId === selectedPatientKey);
    const selectedCreditAllocations = journeyCreditAllocations.filter((allocation) => allocation.patientId === selectedPatientKey);
    const databaseServiceBillingById = useMemo(() => new Map((servicesWorkspace?.treatmentServices ?? []).map((service) => [
        service.id,
        {
            collectedAmount: service.collectedAmount,
            creditAllocatedAmount: service.creditAllocatedAmount,
        },
    ])), [servicesWorkspace?.treatmentServices]);
    const serviceCollectedAmount = (serviceId: string) => databaseServiceBillingById.get(serviceId)?.collectedAmount ??
        selectedReceipts
            .filter((receipt) => receipt.serviceId === serviceId)
            .reduce((total, receipt) => total + receipt.amount, 0);
    const serviceCreditAllocationAmount = (serviceId: string) => databaseServiceBillingById.get(serviceId)?.creditAllocatedAmount ??
        selectedCreditAllocations
            .filter((allocation) => allocation.toServiceId === serviceId)
            .reduce((total, allocation) => total + allocation.amount, 0);
    const serviceAppliedAmount = (serviceId: string) => calculateServiceAppliedAmount(serviceCollectedAmount(serviceId), serviceCreditAllocationAmount(serviceId));
    const updateServiceProgress = (serviceId: string, progress: string) => {
        setPlannedServices((current) => current.map((service) => service.id === serviceId
            ? {
                ...service,
                progress,
            }
            : service));
    };
    const updateServiceDiscount = (serviceId: string, value: string) => {
        const discount = Math.max(Number(value) || 0, 0);
        setPlannedServices((current) => current.map((service) => service.id === serviceId
            ? {
                ...service,
                discount,
                finalPrice: Math.max(service.listPrice - discount, 0),
            }
            : service));
    };
    const removeDraftTreatmentService = (serviceId: string) => {
        setPlannedServices((current) => current.filter((service) => service.id !== serviceId));
    };
    const submitServiceDiscountOnBlur = (event: FocusEvent<HTMLFormElement>, currentDiscount: number) => {
        const form = event.currentTarget;
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && form.contains(nextTarget)) {
            return;
        }
        const formData = new FormData(form);
        const rawDiscount = String(formData.get("discount") ?? "");
        const nextDiscount = rawDiscount.trim() ? Number(rawDiscount) : 0;
        if (!Number.isFinite(nextDiscount) || nextDiscount === currentDiscount) {
            return;
        }
        window.setTimeout(() => {
            if (form.isConnected) {
                form.requestSubmit();
            }
        }, 0);
    };
    const totalDue = selectedInvoices.reduce((total, invoice) => isCollectableInvoice(invoice) ? total + invoiceBalance(invoice) : total, 0);
    const persistedTreatmentServices: JourneyServiceRow[] = selectedPlans.flatMap((plan) => plan.tasks.map((task, index, tasks) => {
        const listPrice = Math.round(plan.patientShare / Math.max(tasks.length, 1));
        return {
            id: `${plan.id}-${task}-${index}`,
            patientId: selectedPatientKey,
            serviceCode: createServiceInstanceCode(selectedPatient, "KHT", index + 1),
            catalogCode: "KHT",
            createdAt: plan.createdAt ? Date.parse(plan.createdAt) || undefined : undefined,
            object: plan.phase,
            diagnosis: plan.title,
            serviceName: task,
            progress: plan.status,
            listPrice,
            discount: 0,
            finalPrice: listPrice,
            source: "plan" as const,
        };
    }));
    const databaseTreatmentServices: JourneyServiceRow[] = servicesWorkspace?.treatmentServices
        .filter((service) => service.patientId === selectedPatientKey)
        .map((service) => ({
        id: service.id,
        clinicId: service.clinicId,
        patientId: service.patientId,
        catalogItemId: service.serviceCatalogItemId ?? undefined,
        serviceCode: service.serviceCode,
        catalogCode: service.catalogCode,
        createdAt: Date.parse(service.createdAt) || undefined,
        createdBy: service.createdByName,
        createdById: service.createdById,
        compensationRuleId: service.compensationRuleId,
        compensationRuleName: service.compensationRuleName,
        object: service.teeth.join(", ") || service.targetSummary || "",
        diagnosis: service.targetSummary ?? "",
        serviceName: service.serviceName,
        progress: serviceProgressLabelFromPercent(service.currentProgressPercent, service.status, service.steps),
        listPrice: service.listPrice,
        discount: Math.max(service.listPrice - service.finalPrice, 0),
        finalPrice: service.finalPrice,
        collectedAmount: service.collectedAmount,
        creditAllocatedAmount: service.creditAllocatedAmount,
        invoicedAmount: service.invoicedAmount,
        invoiceNos: service.invoiceNos,
        progressEvents: service.progressEvents,
        progressSteps: service.steps,
        source: "database" as const,
    })) ?? [];
    const treatmentServices = [
        ...databaseTreatmentServices,
        ...(journeyDatabaseOnly
            ? []
            : plannedServices.filter((service) => service.patientId === selectedPatientKey)),
        ...persistedTreatmentServices,
    ];
    const filteredSelectedPlans = selectedPlans.filter((plan) => matchesChartSearch(chartSearchQuery, [
        plan.title,
        plan.phase,
        plan.status,
        plan.estimatedCost,
        plan.patientShare,
        ...plan.tasks,
    ]));
    const hasTreatmentDraft = Boolean(selectedTreatmentGoal.trim() || selectedTreatmentPlanText.trim());
    const treatmentDraftMatches = matchesChartSearch(chartSearchQuery, [
        selectedTreatmentGoal,
        selectedTreatmentPlanText,
    ]);
    const treatmentPlanSearchCount = filteredSelectedPlans.length + (hasTreatmentDraft && treatmentDraftMatches ? 1 : 0);
    const filteredTreatmentServices = treatmentServices.filter((service) => matchesChartSearch(chartSearchQuery, [
        service.object,
        service.diagnosis,
        service.serviceName,
        service.serviceCode,
        service.catalogCode,
        displayServiceInstanceCode(service, visiblePatientsById.get(service.patientId)),
        service.progress,
        service.listPrice,
        service.discount,
        service.finalPrice,
        serviceAppliedAmount(service.id),
    ]));
    const sessionEvents: JourneyTimelineEvent[] = buildJourneyTimeline({ selectedAppointments, language, selectedNotes, jt, selectedPlans, databaseTreatmentServices, visiblePatientsById, selectedReceipts, treatmentServices, selectedBillingReceipts, selectedInvoices, selectedPrescriptions, selectedPatientForms, selectedPatientFiles, selectedCrmActivities, selectedJourneyComments, timelineComments, selectedPatientKey });
    const timelineGroupEvents = timelineFilter === "All"
        ? sessionEvents
        : sessionEvents.filter((event) => event.group === timelineFilter);
    const filteredSessionEvents = timelineGroupEvents.filter((event) => matchesChartSearch(chartSearchQuery, [
        event.group,
        event.kind,
        event.label,
        event.status,
        event.title,
        event.detail,
        event.imageName,
    ]));
    const timelineDayGroups = groupJourneyTimelineEvents(filteredSessionEvents, language);
    const searchSummary = chartSearchQuery
        ? language === "vi"
            ? `${patientSearchMatches.length} bệnh nhân, ${treatmentPlanSearchCount} kế hoạch, ${filteredTreatmentServices.length} dịch vụ, ${filteredSessionEvents.length} timeline`
            : `${patientSearchMatches.length} patients, ${treatmentPlanSearchCount} plans, ${filteredTreatmentServices.length} services, ${filteredSessionEvents.length} timeline events`
        : jt.chart.searchSummary;
    const renderTimelineImageButton = (src: string, alt: string | undefined, key?: string) => {
        const imageAlt = alt ?? jt.timeline.fileAlt;
        return (<button className="timeline-image-button" key={key} type="button" onClick={(event) => {
                event.stopPropagation();
                setOpenTimelineImage({ alt: imageAlt, src });
            }} aria-label={`${jt.timeline.openImage}: ${imageAlt}`}>
        <img className="timeline-image" src={src} alt={imageAlt}/>
      </button>);
    };
    const renderTimelineAttachment = (attachment: JourneyTimelineAttachment, mode: "compact" | "preview") => {
        const attachmentName = attachment.name ?? jt.timeline.openFile;
        const imageSrc = attachment.thumbnailUrl ?? attachment.previewUrl ?? attachment.url;
        const openImageSrc = attachment.previewUrl ?? attachment.url;
        const isImage = attachment.mimeType?.startsWith("image/");
        const isVideo = attachment.mimeType?.startsWith("video/");
        const fileMeta = [
            timelineFileKindLabel(attachment.fileKind, language),
            attachment.sizeBytes ? formatFileSize(attachment.sizeBytes) : "",
        ]
            .filter(Boolean)
            .join(" · ");
        if (isImage) {
            return (<button className={mode === "preview"
                    ? "timeline-image-button preview"
                    : "timeline-image-button"} type="button" key={attachment.id} onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    setOpenTimelineImage({
                        alt: attachmentName,
                        src: openImageSrc,
                    });
                }} aria-label={`${jt.timeline.openImage}: ${attachmentName}`}>
          <img className={mode === "preview" ? "timeline-image-preview" : "timeline-image"} src={imageSrc} alt={attachmentName}/>
        </button>);
        }
        if (isVideo && mode === "preview") {
            return (<video className="timeline-video-preview" controls key={attachment.id} preload="metadata" src={attachment.url}/>);
        }
        return (<a className="secondary-button timeline-file-link" href={attachment.url} rel="noreferrer" target="_blank" key={attachment.id} onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <FileText size={16}/>
        <span>
          {attachmentName}
          {fileMeta ? <small>{fileMeta}</small> : null}
        </span>
      </a>);
    };
    return { patientFilesWorkspace, session, language, jt, notice, selectedPatient, visiblePatientsById, selectedPatientKey, chartSearchQuery, serviceOptions, selectedTeeth, setSelectedTeeth, odontogramDiagnosis, setOdontogramDiagnosis, selectedServiceId, setSelectedServiceId, timelineFilter, setTimelineFilter, commentBody, setCommentBody, commentAttachments, setCommentAttachments, setCommentImage, openTimelineImage, setOpenTimelineImage, pendingProgressUpdate, setPendingProgressUpdate, selectedJourneyState, selectedOdontogram, selectedAppointments, selectedTreatmentGoal, selectedTreatmentPlanText, updateTreatmentDraft, latestNote, latestExamFields, clinicName, messages, clinicalReady, journeyRecordsReady, canEditTreatmentPlan, odontogramReady, unfinishedClinicalNotes, canCompleteClinicalNotes, journeyServiceDatabaseReady, canDeleteTreatmentServices, selectedLibraryService, progressParticipants, selectedToothTargets, selectedArchTargets, selectedServiceTargets, updateSelectedToothTargets, toggleArchTarget, addServicesFromOdontogram, serviceAppliedAmount, updateServiceProgress, updateServiceDiscount, removeDraftTreatmentService, submitServiceDiscountOnBlur, totalDue, filteredTreatmentServices, sessionEvents, filteredSessionEvents, timelineDayGroups, searchSummary, renderTimelineImageButton, renderTimelineAttachment };
}
export type PatientJourneyPanelModel = ReturnType<typeof usePatientJourneyPanelModel>;
