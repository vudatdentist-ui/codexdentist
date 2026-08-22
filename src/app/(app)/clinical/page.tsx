import { redirect } from "next/navigation";
import { canonicalPatientRoute } from "@/features/patients/server/canonical-patient-route";

export default async function ClinicalPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  redirect(canonicalPatientRoute(params));
}
