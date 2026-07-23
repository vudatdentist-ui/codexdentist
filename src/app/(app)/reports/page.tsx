import { AppViewPage } from "../view-page";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    clinicId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;

  return (
    <AppViewPage
      view="reports"
      reportsClinicId={params?.clinicId}
      reportsFrom={params?.from}
      reportsTo={params?.to}
    />
  );
}
