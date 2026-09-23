import type { DashboardClinicSummary } from "@/lib/dashboard-types";

// Appointment previews are capped upstream. Only complete aggregates can describe the day.
export function summarizeClinicDay(clinics: readonly DashboardClinicSummary[], visibleIds: ReadonlySet<string>) {
  return clinics.filter(clinic => visibleIds.has(clinic.clinicId)).reduce((day, clinic) => ({
    appointments: day.appointments + clinic.todayAppointments,
    inChair: day.inChair + clinic.inChair,
    completed: day.completed + clinic.completed,
    collected: day.collected + clinic.collectedToday,
  }), { appointments: 0, inChair: 0, completed: 0, collected: 0 });
}
