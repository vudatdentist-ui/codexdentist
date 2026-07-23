import { DentalSuite } from "@/components/DentalSuite";
import { requireViewSession } from "@/lib/auth";
import { getAccountingWorkspace } from "@/lib/accounting";
import { getModuleAiRuns } from "@/lib/ai-runs";
import { getBillingWorkspace } from "@/lib/billing";
import { getClinicalWorkspace } from "@/lib/clinical";
import { getCommunityWorkspace } from "@/lib/community";
import { getCrmWorkspace } from "@/lib/crm";
import { getDashboardWorkspace } from "@/lib/dashboard";
import { getPatientPortalWorkspace } from "@/lib/patient-portal";
import { getPatientFilesWorkspace } from "@/lib/patient-files";
import { getPatientWorkspace } from "@/lib/patients";
import { canAccessView, type ViewKey } from "@/lib/permissions";
import { getFormsWorkspace } from "@/lib/forms";
import { getInventoryWorkspace } from "@/lib/inventory";
import { getJourneyRecordsWorkspace } from "@/lib/journey-records";
import { getLearningWorkspace } from "@/lib/learning";
import { getPharmacyWorkspace } from "@/lib/pharmacy";
import { getStaffPayrollWorkspace } from "@/lib/payroll";
import { getReportsWorkspace } from "@/lib/reports";
import { getScheduleWorkspace } from "@/lib/schedule";
import { getServicesWorkspace } from "@/lib/services";
import { getSettingsWorkspace } from "@/lib/settings";
import { getTaskInboxWorkspace } from "@/lib/task-inbox";
import { getTreatmentWorkspace } from "@/lib/treatments";

export async function AppViewPage({
  view,
  accountingPeriodMonth,
  journeyPatientId,
  reportsClinicId,
  reportsFrom,
  reportsTo,
}: {
  view: ViewKey;
  accountingPeriodMonth?: string | null;
  journeyPatientId?: string | null;
  reportsClinicId?: string | null;
  reportsFrom?: string | null;
  reportsTo?: string | null;
}) {
  const session = await requireViewSession(view);
  const usesPatientJourney =
    view === "journey" || view === "clinical" || view === "treatment";
  const shouldLoadPatients =
    view === "patients" ||
    usesPatientJourney ||
    view === "billing" ||
    view === "pharmacy" ||
    view === "forms" ||
    view === "crm";
  const preloadedPatientWorkspace =
    usesPatientJourney && shouldLoadPatients ? await getPatientWorkspace(session) : null;
  const selectedJourneyPatientId =
    usesPatientJourney && journeyPatientId && preloadedPatientWorkspace?.patients.length
      ? preloadedPatientWorkspace.patients.some((patient) => patient.id === journeyPatientId)
        ? journeyPatientId
        : null
      : null;
  const journeyScope = selectedJourneyPatientId
    ? { patientId: selectedJourneyPatientId }
    : undefined;
  const patientWorkspacePromise = preloadedPatientWorkspace
    ? Promise.resolve(preloadedPatientWorkspace)
    : shouldLoadPatients
      ? getPatientWorkspace(session)
      : Promise.resolve(null);
  const scheduleWorkspacePromise =
    view === "schedule" || usesPatientJourney || view === "billing"
      ? getScheduleWorkspace(session, {
          scope: usesPatientJourney || view === "schedule" || view === "billing" ? "all" : "today",
          patientId: selectedJourneyPatientId ?? undefined,
        })
      : Promise.resolve(null);
  const treatmentWorkspacePromise =
    usesPatientJourney
      ? getTreatmentWorkspace(session, journeyScope)
      : Promise.resolve(null);
  const billingWorkspacePromise =
    view === "billing" || (usesPatientJourney && canAccessView(session, "billing"))
      ? getBillingWorkspace(session, usesPatientJourney ? journeyScope : undefined)
      : Promise.resolve(null);
  const clinicalWorkspacePromise =
    usesPatientJourney
      ? getClinicalWorkspace(session, journeyScope)
      : Promise.resolve(null);
  const communityWorkspacePromise =
    view === "community" ? getCommunityWorkspace(session) : Promise.resolve(null);
  const taskInboxWorkspacePromise = getTaskInboxWorkspace(session);
  const dashboardWorkspacePromise =
    view === "dashboard" ? getDashboardWorkspace(session) : Promise.resolve(null);
  const reportsWorkspacePromise =
    view === "reports"
      ? getReportsWorkspace(session, {
          clinicId: reportsClinicId,
          from: reportsFrom,
          to: reportsTo,
        })
      : Promise.resolve(null);
  const accountingWorkspacePromise =
    view === "accounting"
      ? getAccountingWorkspace(session, { periodMonth: accountingPeriodMonth })
      : Promise.resolve(null);
  const patientPortalWorkspacePromise =
    view === "patient-app" ? getPatientPortalWorkspace(session) : Promise.resolve(null);
  const settingsWorkspacePromise =
    view === "settings" || usesPatientJourney || view === "staff" || view === "employee-app"
      ? getSettingsWorkspace(session)
      : Promise.resolve(null);
  const servicesWorkspacePromise =
    view === "services" || usesPatientJourney || view === "staff"
      ? getServicesWorkspace(session, usesPatientJourney ? journeyScope : undefined)
      : Promise.resolve(null);
  const staffPayrollWorkspacePromise =
    view === "staff"
      ? getStaffPayrollWorkspace(session)
      : view === "employee-app"
        ? getStaffPayrollWorkspace(session, { scope: "self" })
        : Promise.resolve(null);
  const crmWorkspacePromise =
    view === "crm" || (usesPatientJourney && canAccessView(session, "crm"))
      ? getCrmWorkspace(session, usesPatientJourney ? journeyScope : undefined)
      : Promise.resolve(null);
  const inventoryWorkspacePromise =
    view === "inventory" ? getInventoryWorkspace(session) : Promise.resolve(null);
  const learningWorkspacePromise =
    view === "learning" ? getLearningWorkspace(session) : Promise.resolve(null);
  const patientFilesWorkspacePromise =
    usesPatientJourney ? getPatientFilesWorkspace(session, journeyScope) : Promise.resolve(null);
  const journeyRecordsWorkspacePromise =
    usesPatientJourney ? getJourneyRecordsWorkspace(session, journeyScope) : Promise.resolve(null);
  const pharmacyWorkspacePromise =
    view === "pharmacy" ||
    (usesPatientJourney && canAccessView(session, "pharmacy"))
      ? getPharmacyWorkspace(session, usesPatientJourney ? journeyScope : undefined)
      : Promise.resolve(null);
  const formsWorkspacePromise =
    view === "forms" || (usesPatientJourney && canAccessView(session, "forms"))
      ? getFormsWorkspace(session, usesPatientJourney ? journeyScope : undefined)
      : Promise.resolve(null);
  const moduleAiRunsPromise = getModuleAiRuns(session, view);

  const [
    accountingWorkspace,
    billingWorkspace,
    clinicalWorkspace,
    communityWorkspace,
    crmWorkspace,
    dashboardWorkspace,
    formsWorkspace,
    inventoryWorkspace,
    journeyRecordsWorkspace,
    learningWorkspace,
    moduleAiRuns,
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
  ] = await Promise.all([
    accountingWorkspacePromise,
    billingWorkspacePromise,
    clinicalWorkspacePromise,
    communityWorkspacePromise,
    crmWorkspacePromise,
    dashboardWorkspacePromise,
    formsWorkspacePromise,
    inventoryWorkspacePromise,
    journeyRecordsWorkspacePromise,
    learningWorkspacePromise,
    moduleAiRunsPromise,
    patientFilesWorkspacePromise,
    patientPortalWorkspacePromise,
    patientWorkspacePromise,
    pharmacyWorkspacePromise,
    reportsWorkspacePromise,
    scheduleWorkspacePromise,
    servicesWorkspacePromise,
    settingsWorkspacePromise,
    staffPayrollWorkspacePromise,
    taskInboxWorkspacePromise,
    treatmentWorkspacePromise,
  ]);

  const scopedScheduleWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(scheduleWorkspace, selectedJourneyPatientId)
      : scheduleWorkspace;
  const scopedTreatmentWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(treatmentWorkspace, selectedJourneyPatientId)
      : treatmentWorkspace;
  const scopedBillingWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(billingWorkspace, selectedJourneyPatientId)
      : billingWorkspace;
  const scopedClinicalWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(clinicalWorkspace, selectedJourneyPatientId)
      : clinicalWorkspace;
  const scopedCrmWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(crmWorkspace, selectedJourneyPatientId)
      : crmWorkspace;
  const scopedPatientFilesWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(patientFilesWorkspace, selectedJourneyPatientId)
      : patientFilesWorkspace;
  const scopedJourneyRecordsWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(journeyRecordsWorkspace, selectedJourneyPatientId)
      : journeyRecordsWorkspace;
  const scopedPharmacyWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(pharmacyWorkspace, selectedJourneyPatientId)
      : pharmacyWorkspace;
  const scopedFormsWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(formsWorkspace, selectedJourneyPatientId)
      : formsWorkspace;
  const scopedServicesWorkspace =
    usesPatientJourney
      ? scopeWorkspacePatientArrays(servicesWorkspace, selectedJourneyPatientId)
      : servicesWorkspace;

  return (
    <DentalSuite
      activeView={view}
      accountingWorkspace={accountingWorkspace}
      billingWorkspace={scopedBillingWorkspace}
      clinicalWorkspace={scopedClinicalWorkspace}
      communityWorkspace={communityWorkspace}
      crmWorkspace={scopedCrmWorkspace}
      dashboardWorkspace={dashboardWorkspace}
      formsWorkspace={scopedFormsWorkspace}
      inventoryWorkspace={inventoryWorkspace}
      journeyRecordsWorkspace={scopedJourneyRecordsWorkspace}
      learningWorkspace={learningWorkspace}
      moduleAiRuns={moduleAiRuns}
      patientFilesWorkspace={scopedPatientFilesWorkspace}
      patientPortalWorkspace={patientPortalWorkspace}
      patientWorkspace={patientWorkspace}
      pharmacyWorkspace={scopedPharmacyWorkspace}
      reportsWorkspace={reportsWorkspace}
      scheduleWorkspace={scopedScheduleWorkspace}
      servicesWorkspace={scopedServicesWorkspace}
      settingsWorkspace={settingsWorkspace}
      session={session}
      staffPayrollWorkspace={staffPayrollWorkspace}
      taskInboxWorkspace={taskInboxWorkspace}
      treatmentWorkspace={scopedTreatmentWorkspace}
    />
  );
}

function scopeWorkspacePatientArrays<T>(workspace: T, patientId: string | null): T {
  if (!workspace || !patientId || typeof workspace !== "object") {
    return workspace;
  }

  const scoped = { ...(workspace as Record<string, unknown>) };

  for (const [key, value] of Object.entries(scoped)) {
    if (!Array.isArray(value)) {
      continue;
    }

    if (key === "patients" && value.some(hasId)) {
      scoped[key] = value.filter((item) => !hasId(item) || item.id === patientId);
      continue;
    }

    if (value.some(hasPatientId)) {
      scoped[key] = value.filter((item) => !hasPatientId(item) || item.patientId === patientId);
    }
  }

  return scoped as T;
}

function hasPatientId(value: unknown): value is { patientId: string | null } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "patientId" in value &&
      typeof (value as { patientId?: unknown }).patientId === "string",
  );
}

function hasId(value: unknown): value is { id: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof (value as { id?: unknown }).id === "string",
  );
}
