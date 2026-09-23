import { Be_Vietnam_Pro, Noto_Serif } from "next/font/google";

// Build-time self-hosting keeps clinical screens independent of browser font CDNs.
export const bodyFont = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body",
});

export const editorialFont = Noto_Serif({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-editorial",
});
