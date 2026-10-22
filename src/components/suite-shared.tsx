"use client";
import { uiText, displayStatus, } from "./suite-copy";
import { normalizeSearchText } from "@/shared/search";
import dynamic from "next/dynamic";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { type ViewKey } from "@/lib/permissions";
import { StatusPill as BaseStatusPill } from "@/components/suite-primitives";
export const Dashboard = dynamic(() => import("@/modules/dashboard/Dashboard").then((module) => module.Dashboard));
export const ScheduleBoard = dynamic(() => import("@/modules/schedule/ScheduleBoard").then((module) => module.ScheduleBoard));
export const PatientsPanel = dynamic(() => import("@/modules/patients/PatientsPanel").then((module) => module.PatientsPanel));
export const PatientJourneyPanel = dynamic(() => import("@/modules/journey/PatientJourneyPanel").then((module) => module.PatientJourneyPanel));
export const BillingPanel = dynamic(() => import("@/modules/billing/BillingPanel").then((module) => module.BillingPanel));
export const AccountingPanel = dynamic(() => import("@/modules/accounting/AccountingPanel").then((module) => module.AccountingPanel));
export const CrmPanel = dynamic(() => import("@/modules/crm/CrmPanel").then((module) => module.CrmPanel));
export const ReportsPanel = dynamic(() => import("@/modules/reports/ReportsPanel").then((module) => module.ReportsPanel));
export const CommunityPanel = dynamic(() => import("@/modules/community/CommunityPanel").then((module) => module.CommunityPanel));
export const PatientAppPanel = dynamic(() => import("@/modules/patient-app/PatientAppPanel").then((module) => module.PatientAppPanel));
export const EmployeeAppPanel = dynamic(() => import("@/modules/employee-app/EmployeeAppPanel").then((module) => module.EmployeeAppPanel));
export const ServicesPanel = dynamic(() => import("@/modules/services/ServicesPanel").then((module) => module.ServicesPanel));
export const PharmacyPanel = dynamic(() => import("@/modules/pharmacy/PharmacyPanel").then((module) => module.PharmacyPanel));
export const FormsPanel = dynamic(() => import("@/modules/forms/FormsPanel").then((module) => module.FormsPanel));
export const InventoryPanel = dynamic(() => import("@/modules/inventory/InventoryPanel").then((module) => module.InventoryPanel));
export const LearningPanel = dynamic(() => import("@/modules/learning/LearningPanel").then((module) => module.LearningPanel));
export const StaffPayrollPanel = dynamic(() => import("@/modules/staff/StaffPayrollPanel").then((module) => module.StaffPayrollPanel));
export const SettingsPanel = dynamic(() => import("@/modules/settings/SettingsPanel").then((module) => module.SettingsPanel));
export const languageStorageKey = "nhavista.language";
export const chainScopeStorageKey = "codexmed.chainScope";
export const actionScrollStorageKey = "codexmed.actionScroll";
export type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";
export type JourneyReceipt = {
    id: string;
    serviceId: string;
    patientId: string;
    patient: string;
    clinicId: string;
    amount: number;
    method: JourneyReceiptMethod;
    collectedAt: number;
};
export function initialLanguage(): Language {
    return "vi";
}
export function saveActionScrollState(pathname: string) {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    window.sessionStorage.setItem(actionScrollStorageKey, JSON.stringify({
        pathname,
        time: Date.now(),
        windowX: window.scrollX,
        windowY: window.scrollY,
        workspaceTop: workspace?.scrollTop ?? 0,
    }));
}
export function restoreActionScrollState(pathname: string) {
    const raw = window.sessionStorage.getItem(actionScrollStorageKey);
    if (!raw) {
        return;
    }
    try {
        const saved = JSON.parse(raw) as {
            pathname?: string;
            time?: number;
            windowX?: number;
            windowY?: number;
            workspaceTop?: number;
        };
        if (saved.pathname !== pathname ||
            !saved.time ||
            Date.now() - saved.time > 30000) {
            return;
        }
        const workspace = document.querySelector<HTMLElement>(".workspace");
        window.scrollTo(saved.windowX ?? 0, saved.windowY ?? 0);
        if (workspace) {
            workspace.scrollTop = saved.workspaceTop ?? 0;
        }
    }
    catch {
        window.sessionStorage.removeItem(actionScrollStorageKey);
    }
}
export function shouldKeepActionNotice(notice: string) {
    if (notice === "module-ai-ready" || notice === "module-ai-failed") {
        return true;
    }
    return /denied|missing|bad|invalid|not-found|unavailable|database|conflict|exists|empty|locked|failed|error|expired/i.test(notice);
}
export function titleFor(view: ViewKey, language: Language) {
    return uiText[language].titles[view];
}
export function matchesChartSearch(query: string, values: Array<string | number | null | undefined>) {
    if (!query) {
        return true;
    }
    return values.some((value) => normalizeSearchText(value).includes(query));
}
export function StatusPill({ status }: {
    status: string;
}) {
    const { language } = useAppLanguage();
    return (<BaseStatusPill label={displayStatus(status, language)} status={status}/>);
}
export { padCodeNumber, stableNumberFromText, patientCodeFor, patientClassCodeFor, patientGenderLabel, patientLeadSourceOptions } from "@/lib/patient-presentation";
export { normalizeSearchText } from "@/shared/search";
export { type UiText, uiText, workspaceText, statusText, displayStatus, journeyTopbarText, billingTopbarText } from "./suite-copy";
export { type AccountingChatOutput, accountingChatOutput, moduleAiOutput, type ModuleAiContextInput, buildModuleAiContext, settingsAiContext, scopeAiWorkspaceToPatient, compactAiValue, stringifyAiContext, normalizeAiStringArray, stringValue } from "./suite-ai-context";
export { type PatientSearchRecord, PatientSearchCombobox, JourneyPatientMenu, patientSearchDisplayLabel, patientLeadSourceLabel, isJourneyTodayAppointment, patientVisitSortValue, patientMatchesExactSelectorSearch, patientSearchMatches, patientSearchRank } from "./SuitePatientControls";
