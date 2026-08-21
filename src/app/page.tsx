import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoLanding } from "@/components/DemoLanding";
import { PublicOdontogram } from "@/components/PublicOdontogram";
import { appRootDomain, demoWorkspaceEnabled } from "@/lib/env";
import {
  currentHostname,
  isLocalHostname,
  systemSubdomainFromHostname,
  tenantSlugFromHostname,
} from "@/lib/tenant";
import { DentalOsLanding } from "./landing/DentalOsLanding";

const marketingMetadata: Metadata = {
  title: "Dental OS - Make your clinic day easier",
  description:
    "Explore Dental OS through real product views for scheduling, patient context, and clinic operations.",
};

const odontogramMetadata: Metadata = {
  title: "Odontogram 5 mặt | Codexdentist",
  description:
    "Mô hình odontogram FDI tương tác với năm mặt răng Mesial, Distal, Buccal, Lingual và Occlusal hoặc Incisal.",
};

export async function generateMetadata(): Promise<Metadata> {
  const hostname = await currentHostname();
  return systemSubdomainFromHostname(hostname) === "odontogram"
    ? odontogramMetadata
    : marketingMetadata;
}

type HomePageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const hostname = await currentHostname();
  const systemSubdomain = systemSubdomainFromHostname(hostname);
  const tenantSlug = tenantSlugFromHostname(hostname);

  if (systemSubdomain === "docs") {
    redirect("/docs");
  }

  if (systemSubdomain === "odontogram") {
    return <PublicOdontogram />;
  }

  if (systemSubdomain === "demo") {
    const params = await searchParams;
    return (
      <DemoLanding
        enabled={demoWorkspaceEnabled()}
        error={params?.error}
        homeUrl={`https://${appRootDomain()}`}
      />
    );
  }

  if (
    tenantSlug ||
    systemSubdomain === "app" ||
    systemSubdomain === "admin"
  ) {
    redirect("/dashboard");
  }

  const demoUrl = isLocalHostname(hostname)
    ? "/demo"
    : `https://demo.${appRootDomain()}`;
  const sourceUrl =
    process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL?.trim() || "/docs#source";

  return <DentalOsLanding demoUrl={demoUrl} sourceUrl={sourceUrl} />;
}
