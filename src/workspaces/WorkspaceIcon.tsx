import { BookOpen, CalendarDays, UsersRound, Route, Stethoscope, ClipboardList,
  Receipt, WalletCards, HeartHandshake, Package, Pill, FileCheck2, Building2,
  UserRound, GraduationCap, MessagesSquare, SlidersHorizontal, Sun, BarChart3,
  Smartphone, type LucideIcon } from "lucide-react";
import type { ViewKey } from "@/lib/permissions";
const icons: Record<ViewKey, LucideIcon> = {
  dashboard: Sun, schedule: CalendarDays, patients: BookOpen, journey: Route,
  clinical: Stethoscope, treatment: ClipboardList, billing: Receipt,
  accounting: WalletCards, crm: HeartHandshake, inventory: Package, pharmacy: Pill,
  forms: FileCheck2, staff: UsersRound, services: Building2, "employee-app": UserRound,
  learning: GraduationCap, community: MessagesSquare, settings: SlidersHorizontal,
  reports: BarChart3, "patient-app": Smartphone,
};
export function WorkspaceIcon({ view, size = 20 }: { view: ViewKey; size?: number }) {
  const Icon = icons[view];
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true" />;
}
