import { ReportsPanel } from "@/modules/reports/ReportsPanel";
import type { Clinic } from "@/lib/data";
import type { ReportsWorkspace as ReportsWorkspaceData } from "@/lib/reports-types";

export function ReportsWorkspace({ data }: { data: ReportsWorkspaceData }) {
  const visibleClinics: Clinic[] = data.clinicReports.map((clinic) => ({
    id: clinic.clinicId,
    chainId: clinic.chainId,
    chainName: clinic.chainName,
    name: clinic.name,
    city: clinic.city,
    chairs: 0,
    doctors: 0,
    todayVisits: clinic.todayVisits,
    utilization: 0,
    production: clinic.production,
    collection: clinic.collection,
    pendingClaims: clinic.consentRenewals,
  }));
  const visibleClinicIds = new Set(visibleClinics.map((clinic) => clinic.id));

  return (
    <ReportsPanel
      reportsWorkspace={data}
      visibleClinicIds={visibleClinicIds}
      visibleClinics={visibleClinics}
    />
  );
}
