"use client";
import { type Patient } from "@/lib/data";
import { type ViewKey } from "@/lib/permissions";
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
import type { AccountingWorkspace } from "@/lib/accounting-types";
import type { BillingWorkspace } from "@/lib/billing-types";
import type { ClinicalWorkspace as ClinicalWorkspaceData } from "@/lib/clinical-types";
import type { CommunityWorkspace as CommunityWorkspaceData } from "@/lib/community-types";
import type { DashboardWorkspace } from "@/lib/dashboard-types";
import type { TreatmentWorkspace } from "@/lib/treatment-types";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";
export type AccountingChatOutput = {
    answer: string;
    takeaways: string[];
    suggestedActions: string[];
    caveats: string[];
};
export function accountingChatOutput(value: unknown): AccountingChatOutput | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const answer = stringValue(record.answer);
    if (!answer) {
        return null;
    }
    return {
        answer,
        takeaways: normalizeAiStringArray(record.takeaways),
        suggestedActions: normalizeAiStringArray(record.suggestedActions),
        caveats: normalizeAiStringArray(record.caveats),
    };
}
export function moduleAiOutput(value: unknown): AccountingChatOutput | null {
    return accountingChatOutput(value);
}
export type ModuleAiContextInput = {
    activeView: ViewKey;
    accountingWorkspace?: AccountingWorkspace | null;
    billingWorkspace?: BillingWorkspace | null;
    clinicalWorkspace?: ClinicalWorkspaceData | null;
    communityWorkspace?: CommunityWorkspaceData | null;
    crmWorkspace?: CrmWorkspace | null;
    dashboardWorkspace?: DashboardWorkspace | null;
    formsWorkspace?: FormsWorkspace | null;
    inventoryWorkspace?: InventoryWorkspace | null;
    journeySelectedPatient?: Patient | null;
    journeyRecordsWorkspace?: JourneyRecordsWorkspace | null;
    learningWorkspace?: LearningWorkspace | null;
    patientFilesWorkspace?: PatientFilesWorkspace | null;
    patientPortalWorkspace?: PatientPortalWorkspace | null;
    patientWorkspace?: PatientWorkspace | null;
    pharmacyWorkspace?: PharmacyWorkspace | null;
    reportsWorkspace?: ReportsWorkspace | null;
    scheduleWorkspace?: ScheduleWorkspace | null;
    servicesWorkspace?: ServicesWorkspace | null;
    settingsWorkspace?: SettingsWorkspace | null;
    staffPayrollWorkspace?: StaffPayrollWorkspace | null;
    taskInboxWorkspace?: TaskInboxWorkspace | null;
    treatmentWorkspace?: TreatmentWorkspace | null;
};
export function buildModuleAiContext(input: ModuleAiContextInput) {
    const workspace = (() => {
        switch (input.activeView) {
            case "dashboard":
                return {
                    dashboardWorkspace: input.dashboardWorkspace,
                    taskInboxWorkspace: input.taskInboxWorkspace,
                };
            case "accounting":
                return { accountingWorkspace: input.accountingWorkspace };
            case "schedule":
                return { scheduleWorkspace: input.scheduleWorkspace };
            case "patients":
                return { patientWorkspace: input.patientWorkspace };
            case "journey":
            case "clinical":
            case "treatment":
                const scopedPatientId = input.journeySelectedPatient?.id ?? "";
                const scopedPatientName = input.journeySelectedPatient?.name;
                return {
                    selectedPatient: input.journeySelectedPatient ?? null,
                    selectedPatientId: scopedPatientId || null,
                    patientWorkspace: scopeAiWorkspaceToPatient(input.patientWorkspace, scopedPatientId, scopedPatientName),
                    clinicalWorkspace: scopeAiWorkspaceToPatient(input.clinicalWorkspace, scopedPatientId, scopedPatientName),
                    treatmentWorkspace: scopeAiWorkspaceToPatient(input.treatmentWorkspace, scopedPatientId, scopedPatientName),
                    billingWorkspace: scopeAiWorkspaceToPatient(input.billingWorkspace, scopedPatientId, scopedPatientName),
                    journeyRecordsWorkspace: scopeAiWorkspaceToPatient(input.journeyRecordsWorkspace, scopedPatientId, scopedPatientName),
                    patientFilesWorkspace: scopeAiWorkspaceToPatient(input.patientFilesWorkspace, scopedPatientId, scopedPatientName),
                    pharmacyWorkspace: scopeAiWorkspaceToPatient(input.pharmacyWorkspace, scopedPatientId, scopedPatientName),
                    formsWorkspace: scopeAiWorkspaceToPatient(input.formsWorkspace, scopedPatientId, scopedPatientName),
                    crmWorkspace: scopeAiWorkspaceToPatient(input.crmWorkspace, scopedPatientId, scopedPatientName),
                };
            case "billing":
                return {
                    billingWorkspace: input.billingWorkspace,
                    patientWorkspace: input.patientWorkspace,
                };
            case "services":
                return { servicesWorkspace: input.servicesWorkspace };
            case "staff":
            case "employee-app":
                return {
                    staffPayrollWorkspace: input.staffPayrollWorkspace,
                    settingsWorkspace: settingsAiContext(input.settingsWorkspace),
                    servicesWorkspace: input.servicesWorkspace,
                };
            case "crm":
                return {
                    crmWorkspace: input.crmWorkspace,
                    patientWorkspace: input.patientWorkspace,
                };
            case "inventory":
                return { inventoryWorkspace: input.inventoryWorkspace };
            case "pharmacy":
                return {
                    pharmacyWorkspace: input.pharmacyWorkspace,
                    patientWorkspace: input.patientWorkspace,
                };
            case "forms":
                return {
                    formsWorkspace: input.formsWorkspace,
                    patientWorkspace: input.patientWorkspace,
                };
            case "learning":
                return { learningWorkspace: input.learningWorkspace };
            case "reports":
                return { reportsWorkspace: input.reportsWorkspace };
            case "community":
                return { communityWorkspace: input.communityWorkspace };
            case "patient-app":
                return { patientPortalWorkspace: input.patientPortalWorkspace };
            case "settings":
                return { settingsWorkspace: settingsAiContext(input.settingsWorkspace) };
            default:
                return {};
        }
    })();
    return compactAiValue({
        activeView: input.activeView,
        generatedAt: new Date().toISOString(),
        workspace,
    });
}
export function settingsAiContext(workspace?: SettingsWorkspace | null) {
    if (!workspace) {
        return workspace;
    }
    const staffByRole = workspace.staff.reduce<Record<string, number>>((totals, member) => {
        const key = member.role;
        totals[key] = (totals[key] ?? 0) + 1;
        return totals;
    }, {});
    const activeStaff = workspace.staff.filter((member) => member.active);
    const inactiveStaff = workspace.staff.filter((member) => !member.active);
    return {
        source: workspace.source,
        canMutate: workspace.canMutate,
        message: workspace.message,
        chains: workspace.chains.map((chain) => ({
            id: chain.id,
            name: chain.name,
            ownerName: chain.ownerName,
            ownerEmail: chain.ownerEmail,
            specialty: chain.specialty,
            active: chain.active,
            clinicCount: chain.clinicCount,
        })),
        clinics: workspace.clinics.map((clinic) => ({
            id: clinic.id,
            name: clinic.name,
            city: clinic.city,
            chainName: clinic.chainName,
            active: clinic.active,
        })),
        archivedClinics: workspace.archivedClinics.map((clinic) => ({
            clinicId: clinic.clinicId,
            name: clinic.name,
            city: clinic.city,
            patientCount: clinic.patientCount,
            appointmentCount: clinic.appointmentCount,
            invoiceCount: clinic.invoiceCount,
            staffCount: clinic.staffCount,
        })),
        staffSummary: {
            total: workspace.staff.length,
            active: activeStaff.length,
            inactive: inactiveStaff.length,
            mustChangePassword: workspace.staff.filter((member) => member.mustChangePassword).length,
            pendingPasswordSetup: workspace.staff.filter((member) => member.hasPendingPasswordSetup).length,
            byRole: staffByRole,
        },
        activeStaffSample: activeStaff.slice(0, 12).map((member) => ({
            id: member.id,
            fullName: member.fullName,
            email: member.email,
            role: member.role,
            title: member.title,
            employeeCode: member.employeeCode,
            primaryClinicId: member.primaryClinicId,
            clinicCount: member.clinics.length,
            lastLoginAt: member.lastLoginAt,
        })),
        inactiveStaffSample: inactiveStaff.slice(0, 8).map((member) => ({
            id: member.id,
            fullName: member.fullName,
            email: member.email,
            role: member.role,
            employeeCode: member.employeeCode,
        })),
        notificationSettings: workspace.notificationSettings,
        aiSettings: workspace.aiSettings,
        sourceCommissionSummary: {
            policies: workspace.sourceCommission.policies.length,
            accruals: workspace.sourceCommission.accruals.length,
            openAccruals: workspace.sourceCommission.accruals.filter((accrual) => accrual.status !== "PAID" && accrual.status !== "VOID").length,
        },
        recentAuditActions: workspace.auditLogs.slice(0, 8).map((log) => ({
            action: log.action,
            actor: log.actor,
            entityType: log.entityType,
            createdAt: log.createdAt,
        })),
        recentAiRuns: workspace.aiRuns.slice(0, 5).map((run) => ({
            module: run.module,
            status: run.status,
            model: run.model,
            error: run.error ? run.error.slice(0, 160) : null,
            createdAt: run.createdAt,
        })),
    };
}
export function scopeAiWorkspaceToPatient<T>(workspace: T, patientId: string, patientName?: string): T {
    if (!workspace || !patientId || typeof workspace !== "object") {
        return workspace;
    }
    const scoped = { ...(workspace as Record<string, unknown>) };
    for (const [key, value] of Object.entries(scoped)) {
        if (!Array.isArray(value)) {
            continue;
        }
        if (key === "patients") {
            scoped[key] = value.filter((item) => {
                const record = item as Record<string, unknown>;
                return record.id === patientId;
            });
            continue;
        }
        const containsPatientScopedRows = value.some((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return false;
            }
            const record = item as Record<string, unknown>;
            return "patientId" in record || "patientName" in record || "patient" in record;
        });
        if (!containsPatientScopedRows) {
            continue;
        }
        scoped[key] = value.filter((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return false;
            }
            const record = item as Record<string, unknown>;
            return (record.patientId === patientId ||
                (patientName && (record.patientName === patientName || record.patient === patientName)));
        });
    }
    return scoped as T;
}
export function compactAiValue(value: unknown, depth = 0): unknown {
    if (value == null || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return value.length > 700 ? `${value.slice(0, 700)}...` : value;
    }
    if (Array.isArray(value)) {
        return {
            count: value.length,
            sample: value.slice(0, depth > 1 ? 8 : 16).map((item) => compactAiValue(item, depth + 1)),
        };
    }
    if (typeof value === "object") {
        if (depth > 4) {
            return "[truncated]";
        }
        const output: Record<string, unknown> = {};
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !/password|token|hash|secret|storageKey|rawOutput/i.test(key))
            .slice(0, 60);
        for (const [key, child] of entries) {
            output[key] = compactAiValue(child, depth + 1);
        }
        return output;
    }
    return String(value);
}
export function stringifyAiContext(context: unknown) {
    const serialized = JSON.stringify(context);
    if (serialized.length <= 110000) {
        return serialized;
    }
    return JSON.stringify({
        note: "Module context was truncated on the client because it exceeded the AI payload budget.",
        truncatedContextPreview: serialized.slice(0, 100000),
    });
}
export function normalizeAiStringArray(value: unknown) {
    return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}
export function stringValue(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
