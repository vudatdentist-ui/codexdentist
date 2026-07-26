import type { Metadata } from "next";
import { PublicOdontogram } from "@/components/PublicOdontogram";

export const metadata: Metadata = {
  title: "Odontogram 5 mặt | Codexdentist",
  description:
    "Mô hình odontogram FDI tương tác với năm mặt răng Mesial, Distal, Buccal, Lingual và Occlusal hoặc Incisal.",
};

export default function OdontogramPage() {
  return <PublicOdontogram />;
}
