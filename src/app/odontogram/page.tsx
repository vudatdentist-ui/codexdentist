import type { Metadata } from "next";
import { OdontogramSurfaceLab } from "@/components/OdontogramSurfaceLab";

export const metadata: Metadata = {
  title: "Odontogram 5 mặt | Codexdentist",
  description:
    "Mô hình odontogram FDI tương tác với năm mặt răng Mesial, Distal, Buccal, Lingual và Occlusal hoặc Incisal.",
};

export default function OdontogramPage() {
  return <OdontogramSurfaceLab />;
}
