import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Codexdentist",
    short_name: "Codexdentist",
    description: "Smart dental solutions powered by AI.",
    start_url: "/employee-app",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7f8",
    theme_color: "#0f766e",
    orientation: "portrait",
    categories: ["health", "medical", "productivity"],
    icons: [
      {
        src: "/icons/codexmed-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/codexmed-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/codexmed-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "App nh\u00e2n vi\u00ean",
        short_name: "Nh\u00e2n vi\u00ean",
        description:
          "Ch\u1ea5m c\u00f4ng, ca l\u00e0m, ngh\u1ec9 ph\u00e9p v\u00e0 l\u01b0\u01a1ng d\u1ecbch v\u1ee5.",
        url: "/employee-app",
        icons: [{ src: "/icons/codexmed-192.png", sizes: "192x192" }],
      },
      {
        name: "\u1ee8ng d\u1ee5ng b\u1ec7nh nh\u00e2n",
        short_name: "B\u1ec7nh nh\u00e2n",
        description:
          "L\u1ecbch h\u1eb9n, \u0111i\u1ec1u tr\u1ecb, thanh to\u00e1n v\u00e0 t\u1ec7p b\u1ec7nh \u00e1n.",
        url: "/patient-app",
        icons: [{ src: "/icons/codexmed-192.png", sizes: "192x192" }],
      },
    ],
  };
}
