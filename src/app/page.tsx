import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoLanding } from "@/components/DemoLanding";
import { PublicOdontogram } from "@/components/PublicOdontogram";
import { appRootDomain, demoWorkspaceEnabled } from "@/lib/env";
import {
  currentHostname,
  systemSubdomainFromHostname,
  tenantSlugFromHostname,
} from "@/lib/tenant";
import { LandingPage } from "./_landing/LandingPage";

const marketingMetadata: Metadata = {
  title: "Codexdentist - Nền tảng vận hành phòng khám nha khoa",
  description:
    "Quản lý lịch hẹn, hồ sơ bệnh nhân, điều trị, thu chi, kho và nhân sự trong một workspace cho cả phòng khám. Dùng thử miễn phí 30 ngày.",
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

  return <LandingPage />;
}
