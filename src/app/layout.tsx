import type { Metadata, Viewport } from "next";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import "codexdentist-odontogram/style.css";
import "react-day-picker/style.css";
import "@/styles/globals.css";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Codexdentist",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Codexdentist",
  },
  title: "Codexdentist",
  description: "Phần mềm quản lý phòng khám nha khoa mã nguồn mở.",
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      {
        url: "/icons/codexmed-icon.svg",
        type: "image/svg+xml",
      },
      {
        url: "/icons/codexmed-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/codexmed-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/codexmed-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: ["/favicon.svg", "/icons/codexmed-192.png"],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>
        {children}
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
