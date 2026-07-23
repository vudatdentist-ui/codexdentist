import { AppViewPage } from "../view-page";

export default async function TreatmentPage({
  searchParams,
}: {
  searchParams?: Promise<{ patientId?: string }>;
}) {
  const params = await searchParams;

  return <AppViewPage view="journey" journeyPatientId={params?.patientId} />;
}
