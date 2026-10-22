"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { type Language } from "@/components/AppLanguage";
import { accessibleViews, type ViewKey } from "@/lib/permissions";
import type { PatientWorkspace } from "@/lib/patient-types";
import type { PatientPortalWorkspace } from "@/lib/patient-portal-types";
import type { PatientFilesWorkspace } from "@/lib/patient-files-types";
import type { PharmacyWorkspace } from "@/lib/pharmacy-types";
import type { CrmWorkspace } from "@/lib/crm-types";
import type { InventoryWorkspace } from "@/lib/inventory-types";
import type { JourneyRecordsWorkspace } from "@/lib/journey-records-types";
import type { LearningWorkspace } from "@/lib/learning-types";
import type { StaffPayrollWorkspace } from "@/lib/payroll-types";
import type { FormsWorkspace } from "@/lib/forms-types";
import type { ReportsWorkspace } from "@/lib/reports-types";
import type { ScheduleWorkspace } from "@/lib/schedule-types";
import type { ServicesWorkspace } from "@/lib/services-types";
import type { SettingsWorkspace } from "@/lib/settings-types";
import type { StaffDirectoryMember } from "@/lib/staff-directory";
import type { AppSession } from "@/lib/session";
import type { AccountingWorkspace } from "@/lib/accounting-types";
import type { ModuleAiRunSummary } from "@/lib/ai-runs-types";
import type { BillingWorkspace } from "@/lib/billing-types";
import type { ClinicalWorkspace as ClinicalWorkspaceData } from "@/lib/clinical-types";
import type { CommunityWorkspace as CommunityWorkspaceData } from "@/lib/community-types";
import type { DashboardWorkspace } from "@/lib/dashboard-types";
import type { TreatmentWorkspace } from "@/lib/treatment-types";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";
import { languageStorageKey, chainScopeStorageKey, uiText, JourneyReceipt, initialLanguage, saveActionScrollState, restoreActionScrollState, shouldKeepActionNotice, patientCodeFor, PatientSearchRecord, patientSearchMatches, normalizeSearchText, matchesChartSearch, moduleAiOutput, buildModuleAiContext, stringifyAiContext } from "./suite-shared";
export function useDentalSuiteModel({ activeView, staffDirectory = [], accountingWorkspace, billingWorkspace, clinicalWorkspace, communityWorkspace, crmWorkspace, dashboardWorkspace, formsWorkspace, inventoryWorkspace, journeyRecordsWorkspace, learningWorkspace, moduleAiRuns, patientFilesWorkspace, patientPortalWorkspace, patientWorkspace, pharmacyWorkspace, reportsWorkspace, scheduleWorkspace, servicesWorkspace, settingsWorkspace, session, staffPayrollWorkspace, taskInboxWorkspace, treatmentWorkspace, }: {
    activeView: ViewKey;
    staffDirectory?: StaffDirectoryMember[];
    accountingWorkspace?: AccountingWorkspace | null;
    billingWorkspace?: BillingWorkspace | null;
    clinicalWorkspace?: ClinicalWorkspaceData | null;
    communityWorkspace?: CommunityWorkspaceData | null;
    crmWorkspace?: CrmWorkspace | null;
    dashboardWorkspace?: DashboardWorkspace | null;
    formsWorkspace?: FormsWorkspace | null;
    inventoryWorkspace?: InventoryWorkspace | null;
    journeyRecordsWorkspace?: JourneyRecordsWorkspace | null;
    learningWorkspace?: LearningWorkspace | null;
    moduleAiRuns?: ModuleAiRunSummary[];
    patientFilesWorkspace?: PatientFilesWorkspace | null;
    patientPortalWorkspace?: PatientPortalWorkspace | null;
    patientWorkspace?: PatientWorkspace | null;
    pharmacyWorkspace?: PharmacyWorkspace | null;
    reportsWorkspace?: ReportsWorkspace | null;
    scheduleWorkspace?: ScheduleWorkspace | null;
    servicesWorkspace?: ServicesWorkspace | null;
    settingsWorkspace?: SettingsWorkspace | null;
    session: AppSession;
    staffPayrollWorkspace?: StaffPayrollWorkspace | null;
    taskInboxWorkspace?: TaskInboxWorkspace | null;
    treatmentWorkspace?: TreatmentWorkspace | null;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const routeSearchParams = useSearchParams();
    const routeSearchParamString = routeSearchParams.toString();
    const requestedPatientId = routeSearchParams.get("patientId") ?? "";
    const requestedPatientRouteKey = `${activeView}:${requestedPatientId}`;
    const [appliedRoutePatientId, setAppliedRoutePatientId] = useState("");
    const [language, setLanguage] = useState<Language>(initialLanguage);
    const [languageLoaded, setLanguageLoaded] = useState(false);
    const t = uiText[language];
    const [journeyChartSearch, setJourneyChartSearch] = useState("");
    const [billingSearch, setBillingSearch] = useState("");
    const [patientLookupSearch, setPatientLookupSearch] = useState("");
    const [patientFilterId, setPatientFilterId] = useState("all");
    const [chainScopeId, setChainScopeId] = useState("all");
    const [journeySelectedPatientId, setJourneySelectedPatientId] = useState("");
    const [journeyPatientMenuOpen, setJourneyPatientMenuOpen] = useState(false);
    const [journeySearchShowsSelectedPatientLabel, setJourneySearchShowsSelectedPatientLabel,] = useState(true);
    const moduleAiNotice = routeSearchParams.get("notice");
    const showModuleAiResult = moduleAiNotice === "module-ai-ready" || moduleAiNotice === "module-ai-failed";
    const [moduleAiModalOpen, setModuleAiModalOpen] = useState(showModuleAiResult);
    const journeyReceipts: JourneyReceipt[] = [];
    const journeyInvoiceIds = useMemo(() => new Set<string>(), []);
    useEffect(() => {
        const saveFromEvent = (event: Event) => {
            const target = event.target;
            if (target instanceof HTMLFormElement ||
                (target instanceof HTMLElement && target.closest("form"))) {
                saveActionScrollState(pathname);
            }
        };
        document.addEventListener("submit", saveFromEvent, true);
        document.addEventListener("change", saveFromEvent, true);
        document.addEventListener("click", saveFromEvent, true);
        return () => {
            document.removeEventListener("submit", saveFromEvent, true);
            document.removeEventListener("change", saveFromEvent, true);
            document.removeEventListener("click", saveFromEvent, true);
        };
    }, [pathname]);
    useLayoutEffect(() => {
        restoreActionScrollState(pathname);
        const animationFrame = window.requestAnimationFrame(() => restoreActionScrollState(pathname));
        const timeout = window.setTimeout(() => restoreActionScrollState(pathname), 160);
        return () => {
            window.cancelAnimationFrame(animationFrame);
            window.clearTimeout(timeout);
        };
    }, [pathname, routeSearchParamString]);
    useEffect(() => {
        const notice = routeSearchParams.get("notice");
        if (!notice || shouldKeepActionNotice(notice)) {
            return;
        }
        const nextParams = new URLSearchParams(routeSearchParamString);
        nextParams.delete("notice");
        const nextQuery = nextParams.toString();
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
            scroll: false,
        });
    }, [pathname, routeSearchParams, routeSearchParamString, router]);
    useEffect(() => {
        const storedLanguage = window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "vi";
        setLanguage(storedLanguage);
        setChainScopeId(window.localStorage.getItem(chainScopeStorageKey) || "all");
        setLanguageLoaded(true);
    }, []);
    useEffect(() => {
        if (!languageLoaded) {
            return;
        }
        window.localStorage.setItem(languageStorageKey, language);
    }, [language, languageLoaded]);
    useEffect(() => {
        if (!languageLoaded) {
            return;
        }
        window.localStorage.setItem(chainScopeStorageKey, chainScopeId);
    }, [chainScopeId, languageLoaded]);
    useEffect(() => {
        if (showModuleAiResult) {
            setModuleAiModalOpen(true);
        }
    }, [showModuleAiResult]);
    const sessionClinics = useMemo(() => session.clinics.map((clinic) => ({
        ...clinic,
        chainId: null,
        chainName: null,
        chairs: 0,
        doctors: 0,
        todayVisits: 0,
        utilization: 0,
        production: 0,
        collection: 0,
        pendingClaims: 0,
    })), [session.clinics]);
    const availableClinics = useMemo(() => {
        const allowedClinicIds = new Set(session.clinicIds);
        const clinicSource = patientWorkspace?.clinics ??
            scheduleWorkspace?.clinics ??
            settingsWorkspace?.clinics.map((clinic) => ({
                ...clinic,
                chairs: 0,
                doctors: 0,
                todayVisits: 0,
                utilization: 0,
                production: 0,
                collection: 0,
                pendingClaims: 0,
            })) ??
            sessionClinics;
        return clinicSource.filter((clinic) => allowedClinicIds.has(clinic.id));
    }, [
        patientWorkspace?.clinics,
        scheduleWorkspace?.clinics,
        settingsWorkspace?.clinics,
        session.clinicIds,
        sessionClinics,
    ]);
    const chainOptions = useMemo(() => {
        const fromSettings = settingsWorkspace?.chains
            .filter((chain) => chain.active)
            .map((chain) => ({ id: chain.id, name: chain.name })) ?? [];
        const chains = new Map(fromSettings.map((chain) => [chain.id, chain.name]));
        for (const clinic of availableClinics) {
            if (clinic.chainId) {
                chains.set(clinic.chainId, clinic.chainName ?? chains.get(clinic.chainId) ?? clinic.chainId);
            }
        }
        return Array.from(chains, ([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
    }, [availableClinics, settingsWorkspace?.chains]);
    useEffect(() => {
        if (chainScopeId !== "all" &&
            !chainOptions.some((chain) => chain.id === chainScopeId)) {
            setChainScopeId("all");
        }
    }, [chainOptions, chainScopeId]);
    const permittedViews = useMemo(() => new Set(accessibleViews(session)), [session]);
    const visibleClinics = useMemo(() => chainScopeId === "all"
        ? availableClinics
        : availableClinics.filter((clinic) => clinic.chainId === chainScopeId), [availableClinics, chainScopeId]);
    const visibleClinicIds = useMemo(() => new Set(visibleClinics.map((clinic) => clinic.id)), [visibleClinics]);
    const appointmentSource = scheduleWorkspace?.appointments ?? [];
    const visibleAppointments = useMemo(() => appointmentSource.filter((appointment) => visibleClinicIds.has(appointment.clinicId)), [appointmentSource, visibleClinicIds]);
    const patientSource = patientWorkspace?.patients ?? clinicalWorkspace?.patients ?? [];
    const visiblePatients = useMemo(() => patientWorkspace || clinicalWorkspace
        ? patientSource
        : patientSource.filter((patient) => visibleClinicIds.has(patient.clinicId)), [clinicalWorkspace, patientSource, patientWorkspace, visibleClinicIds]);
    const schedulePatientById = useMemo(() => {
        const patients = new Map<string, PatientSearchRecord>();
        for (const patient of visiblePatients) {
            patients.set(patient.id, patient);
        }
        for (const patient of scheduleWorkspace?.patients ?? []) {
            if (!patients.has(patient.id)) {
                patients.set(patient.id, patient);
            }
        }
        return patients;
    }, [scheduleWorkspace?.patients, visiblePatients]);
    const usesJourneyControls = activeView === "journey" || activeView === "clinical" || activeView === "treatment";
    const usesSharedPatientFilter = activeView === "schedule" || activeView === "patients" || activeView === "billing";
    const hasTopbarControls = usesJourneyControls || usesSharedPatientFilter;
    const exactPatientFilter = usesSharedPatientFilter &&
        patientFilterId !== "all" &&
        visiblePatients.some((patient) => patient.id === patientFilterId)
        ? patientFilterId
        : "";
    const exactPatient = exactPatientFilter
        ? visiblePatients.find((patient) => patient.id === exactPatientFilter)
        : undefined;
    const journeyChartSearchQuery = normalizeSearchText(journeyChartSearch.trim());
    const billingTopbarSearchQuery = normalizeSearchText(billingSearch.trim());
    const patientLookupSearchQuery = normalizeSearchText(patientLookupSearch.trim());
    const journeySelectedPatient = visiblePatients.find((patient) => patient.id === journeySelectedPatientId) ?? null;
    const journeyPatientSearchMatches = patientSearchMatches(visiblePatients, journeyChartSearchQuery);
    const selectJourneyPatient = (patient: PatientSearchRecord) => {
        setJourneySelectedPatientId(patient.id);
        setJourneyChartSearch("");
        setJourneySearchShowsSelectedPatientLabel(true);
        router.push(`/journey?patientId=${encodeURIComponent(patient.id)}`);
    };
    const openPatientRoute = (view: "patients" | "billing", patientId: string) => {
        setJourneyPatientMenuOpen(false);
        router.push(`/${view}?patientId=${encodeURIComponent(patientId)}`);
    };
    const billingPatientSearchMatches = patientSearchMatches(visiblePatients, billingTopbarSearchQuery);
    const billingSelectedPatient = patientFilterId === "all"
        ? undefined
        : visiblePatients.find((patient) => patient.id === patientFilterId);
    const patientLookupSearchMatches = patientSearchMatches(visiblePatients, patientLookupSearchQuery);
    const selectedSharedPatient = patientFilterId === "all"
        ? undefined
        : visiblePatients.find((patient) => patient.id === patientFilterId);
    const treatmentSource = treatmentWorkspace?.plans ?? [];
    const visiblePlans = useMemo(() => treatmentWorkspace
        ? treatmentSource
        : treatmentSource.filter((plan) => visibleClinicIds.has(plan.clinicId)), [treatmentSource, treatmentWorkspace, visibleClinicIds]);
    const invoiceSource = billingWorkspace?.invoices ?? [];
    const visibleInvoices = useMemo(() => invoiceSource.filter((invoice) => visibleClinicIds.has(invoice.clinicId)), [invoiceSource, visibleClinicIds]);
    const patientScopedPatients = exactPatientFilter
        ? visiblePatients.filter((patient) => patient.id === exactPatientFilter)
        : visiblePatients;
    const patientScopedAppointments = exactPatientFilter
        ? visibleAppointments.filter((appointment) => appointment.patientId === exactPatientFilter)
        : visibleAppointments;
    const scheduleScopedAppointments = activeView === "schedule" && patientLookupSearchQuery
        ? patientScopedAppointments.filter((appointment) => {
            const patient = schedulePatientById.get(appointment.patientId);
            return matchesChartSearch(patientLookupSearchQuery, [
                appointment.patient,
                appointment.provider,
                appointment.procedure,
                appointment.room,
                appointment.status,
                appointment.time,
                patient?.name,
                patient?.phone,
                patient ? patientCodeFor(patient) : null,
                patient?.email,
                patient?.nationalId,
                patient?.address,
            ]);
        })
        : patientScopedAppointments;
    const patientScopedInvoices = exactPatientFilter
        ? visibleInvoices.filter((invoice) => invoice.patientId === exactPatientFilter ||
            (exactPatient && invoice.patient === exactPatient.name))
        : visibleInvoices;
    useEffect(() => {
        if (visiblePatients.length === 0) {
            if (journeySelectedPatientId) {
                setJourneySelectedPatientId("");
                setJourneySearchShowsSelectedPatientLabel(false);
            }
            return;
        }
        if (usesJourneyControls &&
            requestedPatientRouteKey !== appliedRoutePatientId &&
            visiblePatients.some((patient) => patient.id === requestedPatientId)) {
            setAppliedRoutePatientId(requestedPatientRouteKey);
            setJourneySelectedPatientId(requestedPatientId);
            setJourneyChartSearch("");
            setJourneySearchShowsSelectedPatientLabel(true);
            return;
        }
        if (journeySelectedPatientId &&
            !visiblePatients.some((patient) => patient.id === journeySelectedPatientId)) {
            setJourneySelectedPatientId("");
            setJourneySearchShowsSelectedPatientLabel(false);
        }
    }, [
        appliedRoutePatientId,
        journeySelectedPatientId,
        requestedPatientId,
        requestedPatientRouteKey,
        usesJourneyControls,
        visiblePatients,
    ]);
    useEffect(() => {
        if (usesSharedPatientFilter &&
            requestedPatientRouteKey !== appliedRoutePatientId &&
            visiblePatients.some((patient) => patient.id === requestedPatientId)) {
            setAppliedRoutePatientId(requestedPatientRouteKey);
            setPatientFilterId(requestedPatientId);
            setBillingSearch("");
            setPatientLookupSearch("");
            return;
        }
        if (patientFilterId !== "all" &&
            !visiblePatients.some((patient) => patient.id === patientFilterId)) {
            setPatientFilterId("all");
        }
    }, [
        appliedRoutePatientId,
        patientFilterId,
        requestedPatientId,
        requestedPatientRouteKey,
        usesSharedPatientFilter,
        visiblePatients,
    ]);
    const production = visibleClinics.reduce((total, clinic) => total + clinic.production, 0);
    const collection = visibleClinics.reduce((total, clinic) => total + clinic.collection, 0);
    const todayVisits = visibleClinics.reduce((total, clinic) => total + clinic.todayVisits, 0);
    const utilization = Math.round(visibleClinics.reduce((total, clinic) => total + clinic.utilization, 0) /
        Math.max(visibleClinics.length, 1));
    const latestModuleAiRun = moduleAiRuns?.[0] ?? null;
    const latestModuleAiOutput = moduleAiOutput(latestModuleAiRun?.output);
    const moduleAiSupported = session.role !== "PATIENT";
    const moduleAiContextJson = useMemo(() => {
        const context = buildModuleAiContext({
            activeView,
            accountingWorkspace,
            billingWorkspace,
            clinicalWorkspace,
            communityWorkspace,
            crmWorkspace,
            dashboardWorkspace,
            formsWorkspace,
            inventoryWorkspace,
            journeySelectedPatient,
            journeyRecordsWorkspace,
            learningWorkspace,
            patientFilesWorkspace,
            patientPortalWorkspace,
            patientWorkspace,
            pharmacyWorkspace,
            reportsWorkspace,
            scheduleWorkspace,
            servicesWorkspace,
            settingsWorkspace,
            staffPayrollWorkspace,
            taskInboxWorkspace,
            treatmentWorkspace,
        });
        return stringifyAiContext(context);
    }, [
        activeView,
        accountingWorkspace,
        billingWorkspace,
        clinicalWorkspace,
        communityWorkspace,
        crmWorkspace,
        dashboardWorkspace,
        formsWorkspace,
        inventoryWorkspace,
        journeySelectedPatient,
        journeyRecordsWorkspace,
        learningWorkspace,
        patientFilesWorkspace,
        patientPortalWorkspace,
        patientWorkspace,
        pharmacyWorkspace,
        reportsWorkspace,
        scheduleWorkspace,
        servicesWorkspace,
        settingsWorkspace,
        staffPayrollWorkspace,
        taskInboxWorkspace,
        treatmentWorkspace,
    ]);
    const moduleAiText = language === "vi"
        ? {
            action: "Gửi task cho AI",
            answerReady: "Kết quả gần nhất",
            caveats: "Giới hạn",
            close: "Đóng",
            empty: "Nhập task cụ thể để AI phân tích mục đang mở.",
            failed: "Lần gọi AI gần nhất bị lỗi",
            history: "Lịch sử gần đây",
            open: "Mở AI",
            patientContext: "Ngữ cảnh bệnh nhân",
            placeholder: "Ví dụ: Tìm 3 điểm bất thường, giải thích nguyên nhân có thể và đề xuất việc cần làm.",
            prompt: "Task muốn giao cho AI",
            suggestedActions: "Việc nên làm",
            suggestionOnly: "AI chỉ đưa gợi ý và không tự ghi dữ liệu vào hệ thống.",
            takeaways: "Điểm chính",
            title: "CodexMed AI",
            tokens: "tokens",
        }
        : {
            action: "Send task to AI",
            answerReady: "Latest result",
            caveats: "Caveats",
            close: "Close",
            empty: "Enter a specific task for AI to analyze the current module.",
            failed: "Latest AI call failed",
            history: "Recent history",
            open: "Open AI",
            patientContext: "Patient context",
            placeholder: "Example: Find 3 anomalies, explain possible causes, and suggest next actions.",
            prompt: "Task for AI",
            suggestedActions: "Suggested actions",
            suggestionOnly: "AI provides suggestions only and does not write data to the system.",
            takeaways: "Takeaways",
            title: "CodexMed AI",
            tokens: "tokens",
        };
    const moduleAiMeta = latestModuleAiRun?.totalTokens
        ? `${latestModuleAiRun.model} · ${latestModuleAiRun.totalTokens} tokens`
        : latestModuleAiRun?.model ?? "";
    return { activeView, staffDirectory, accountingWorkspace, billingWorkspace, clinicalWorkspace, communityWorkspace, crmWorkspace, dashboardWorkspace, formsWorkspace, inventoryWorkspace, journeyRecordsWorkspace, learningWorkspace, moduleAiRuns, patientFilesWorkspace, patientPortalWorkspace, patientWorkspace, pharmacyWorkspace, reportsWorkspace, scheduleWorkspace, servicesWorkspace, settingsWorkspace, session, staffPayrollWorkspace, taskInboxWorkspace, treatmentWorkspace, language, setLanguage, t, journeyChartSearch, setJourneyChartSearch, billingSearch, setBillingSearch, patientLookupSearch, setPatientLookupSearch, patientFilterId, setPatientFilterId, chainScopeId, setChainScopeId, journeyPatientMenuOpen, setJourneyPatientMenuOpen, journeySearchShowsSelectedPatientLabel, setJourneySearchShowsSelectedPatientLabel, showModuleAiResult, moduleAiModalOpen, setModuleAiModalOpen, journeyReceipts, journeyInvoiceIds, chainOptions, permittedViews, visibleClinics, visibleClinicIds, visibleAppointments, visiblePatients, usesJourneyControls, hasTopbarControls, journeySelectedPatient, journeyPatientSearchMatches, selectJourneyPatient, openPatientRoute, billingPatientSearchMatches, billingSelectedPatient, patientLookupSearchMatches, selectedSharedPatient, visiblePlans, visibleInvoices, patientScopedPatients, patientScopedAppointments, scheduleScopedAppointments, patientScopedInvoices, production, collection, todayVisits, utilization, latestModuleAiRun, latestModuleAiOutput, moduleAiSupported, moduleAiContextJson, moduleAiText, moduleAiMeta };
}
export type DentalSuiteModel = ReturnType<typeof useDentalSuiteModel>;
