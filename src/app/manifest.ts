import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Codexdentist",
    short_name: "Codexdentist",
    description: "Lịch hẹn, bệnh án và công việc của phòng khám trong cùng một không gian.",
    start_url: "/employee-app",
    scope: "/",
    display: "standalone",
    background_color: "#f6f4ee",
    theme_color: "#234936",
    orientation: "portrait",
    categories: ["health", "medical", "productivity"],
    icons: [
      { src: "/icons/codexmed-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/codexmed-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/codexmed-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Ca làm của tôi",
        short_name: "Ca làm",
        description: "Chấm công, ca làm, nghỉ phép và lương dịch vụ.",
        url: "/employee-app",
        icons: [{ src: "/icons/codexmed-192.png", sizes: "192x192" }],
      },
      {
        name: "Cổng bệnh nhân",
        short_name: "Bệnh nhân",
        description: "Lịch hẹn, điều trị, thanh toán và tệp bệnh án.",
        url: "/patient-app",
        icons: [{ src: "/icons/codexmed-192.png", sizes: "192x192" }],
      },
    ],
  };
}
