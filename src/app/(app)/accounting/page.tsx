import { AppViewPage } from "../view-page";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const params = await searchParams;

  return <AppViewPage view="accounting" accountingPeriodMonth={params?.month} />;
}
