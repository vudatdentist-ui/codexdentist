import { redirect } from "next/navigation";
import { DemoLanding } from "@/components/DemoLanding";
import { demoWorkspaceEnabled } from "@/lib/env";
import { currentHostname, systemSubdomainFromHostname } from "@/lib/tenant";

type DemoPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function DemoPage({ searchParams }: DemoPageProps) {
  const params = await searchParams;
  const hostname = await currentHostname();

  if (systemSubdomainFromHostname(hostname) === "demo") {
    const query = params?.error ? `?error=${encodeURIComponent(params.error)}` : "";
    redirect(`/${query}`);
  }

  return (
    <DemoLanding
      enabled={demoWorkspaceEnabled()}
      error={params?.error}
      homeUrl="/"
    />
  );
}
