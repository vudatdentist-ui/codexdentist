import { notFound } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { getPrintablePrescription } from "@/lib/pharmacy";

export default async function PrescriptionPrintPage({
  params,
}: {
  params: Promise<{ prescriptionNo: string }>;
}) {
  const session = await requireViewSession("pharmacy");
  const { prescriptionNo } = await params;
  const prescription = await getPrintablePrescription(
    session,
    decodeURIComponent(prescriptionNo),
  );

  if (!prescription || prescription.status !== "SIGNED") {
    notFound();
  }

  return (
    <main className="prescription-print-page">
      <style>{`
        @page { size: A4; margin: 14mm; }
        * { box-sizing: border-box; }
        body { background: #eef2f7; color: #111827; font-family: "Times New Roman", Times, serif; font-size: 14px; line-height: 1.35; }
        .prescription-print-page { width: 210mm; min-height: 297mm; margin: 24px auto; background: white; padding: 16mm; border: 1px solid #d1d5db; }
        .clinic-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; border-bottom: 1.5px solid #111827; padding-bottom: 10px; }
        .clinic-head p, .rx-meta p, .patient-grid p, .footer-note p { margin: 2px 0; }
        .clinic-name { font-size: 15px; font-weight: 700; text-transform: uppercase; }
        .rx-meta { text-align: right; white-space: nowrap; }
        h1 { font-size: 25px; letter-spacing: .08em; margin: 18px 0 12px; text-align: center; text-transform: uppercase; }
        .patient-grid { border: 1px solid #111827; display: grid; grid-template-columns: 1.1fr .55fr .55fr; margin-bottom: 12px; }
        .patient-cell { min-height: 30px; padding: 6px 8px; border-bottom: 1px solid #111827; border-right: 1px solid #111827; }
        .patient-cell:nth-child(3), .patient-cell:nth-child(6), .patient-address { border-right: 0; }
        .patient-address { grid-column: 1 / -1; border-bottom: 0; }
        .label { color: #374151; font-size: 12px; text-transform: uppercase; }
        .value { font-weight: 700; }
        .diagnosis { border: 1px solid #111827; min-height: 42px; padding: 8px; margin-bottom: 14px; }
        .rx-table { border-collapse: collapse; width: 100%; }
        .rx-table th, .rx-table td { border: 1px solid #111827; padding: 7px 8px; vertical-align: top; }
        .rx-table th { background: #f3f4f6; text-align: left; }
        .rx-table .stt { text-align: center; width: 36px; }
        .rx-table .qty { text-align: center; width: 92px; white-space: nowrap; }
        .drug-name { font-weight: 700; }
        .drug-use { margin-top: 4px; white-space: pre-line; }
        .footer-grid { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 32px; margin-top: 22px; }
        .footer-note { border: 1px solid #111827; min-height: 72px; padding: 8px; }
        .signature { text-align: center; }
        .signature-space { height: 72px; }
        .prescriber { font-weight: 700; }
        .small-note { color: #4b5563; font-size: 12px; margin-top: 14px; }
        @media print {
          body { background: white; }
          .prescription-print-page { border: 0; margin: 0; padding: 0; width: auto; min-height: auto; }
        }
      `}</style>

      <header className="clinic-head">
        <div>
          <p className="clinic-name">{prescription.clinicName || prescription.organizationName}</p>
          <p>{prescription.organizationName}</p>
          <p>Địa chỉ: {prescription.clinicAddress || prescription.clinicCity || "-"}</p>
          <p>Điện thoại: {prescription.clinicPhone || "-"}</p>
        </div>
        <div className="rx-meta">
          <p>Số đơn: <strong>{prescription.prescriptionNo}</strong></p>
          <p>Ngày kê: {prescription.signedAt ?? prescription.createdAt}</p>
        </div>
      </header>

      <h1>Đơn thuốc</h1>

      <section className="patient-grid">
        <div className="patient-cell">
          <p className="label">Họ tên người bệnh</p>
          <p className="value">{prescription.patientName}</p>
        </div>
        <div className="patient-cell">
          <p className="label">Ngày sinh / tuổi</p>
          <p>{[prescription.patientDateOfBirth, prescription.patientAge ? `${prescription.patientAge} tuổi` : null].filter(Boolean).join(" - ") || "-"}</p>
        </div>
        <div className="patient-cell">
          <p className="label">Giới tính</p>
          <p>{genderLabel(prescription.patientGender) ?? "-"}</p>
        </div>
        <div className="patient-cell">
          <p className="label">Mã định danh/CCCD</p>
          <p>{prescription.patientNationalId ?? "-"}</p>
        </div>
        <div className="patient-cell">
          <p className="label">Điện thoại</p>
          <p>{prescription.patientPhone ?? "-"}</p>
        </div>
        <div className="patient-cell">
          <p className="label">Người giám hộ</p>
          <p>{prescription.patientGuardianName ?? "-"}</p>
        </div>
        <div className="patient-cell patient-address">
          <p className="label">Địa chỉ liên hệ</p>
          <p>{prescription.patientAddress ?? "-"}</p>
        </div>
      </section>

      <section className="diagnosis">
        <span className="label">Chẩn đoán: </span>
        <strong>{prescription.diagnosis ?? "-"}</strong>
      </section>

      <table className="rx-table">
        <thead>
          <tr>
            <th className="stt">STT</th>
            <th>Thuốc, hàm lượng/nồng độ, cách dùng</th>
            <th className="qty">Số lượng</th>
          </tr>
        </thead>
        <tbody>
          {prescription.items.map((item, index) => (
            <tr key={item.id}>
              <td className="stt">{index + 1}</td>
              <td>
                <div className="drug-name">{item.drugName}</div>
                <div className="drug-use">
                  {[item.sig, item.instructions].filter(Boolean).join("\n")}
                </div>
              </td>
              <td className="qty">{item.quantity ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="footer-grid">
        <div>
          <div className="footer-note">
            <p><strong>Lời dặn:</strong></p>
            <p>{prescription.notes ?? "Dùng thuốc đúng hướng dẫn. Tái khám hoặc liên hệ cơ sở khám chữa bệnh nếu có dấu hiệu bất thường."}</p>
          </div>
          <p className="small-note">Khi tái khám, người bệnh mang theo đơn này và thông báo mọi phản ứng bất lợi nếu có.</p>
        </div>
        <div className="signature">
          <p>Ngày {dateParts(prescription.signedAtIso ?? prescription.createdAtIso).day} tháng {dateParts(prescription.signedAtIso ?? prescription.createdAtIso).month} năm {dateParts(prescription.signedAtIso ?? prescription.createdAtIso).year}</p>
          <p><strong>Người kê đơn</strong></p>
          <p className="small-note">(Ký, ghi rõ họ tên)</p>
          <div className="signature-space" />
          <p className="prescriber">{prescription.prescriberName}</p>
        </div>
      </section>
    </main>
  );
}

function genderLabel(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "MALE" || normalized === "M" || normalized === "NAM") {
    return "Nam";
  }

  if (normalized === "FEMALE" || normalized === "F" || normalized === "NU" || normalized === "NỮ") {
    return "Nữ";
  }

  if (normalized === "OTHER") {
    return "Khác";
  }

  return value;
}

function dateParts(iso: string | null) {
  const date = iso ? new Date(iso) : new Date();

  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    year: String(date.getFullYear()),
  };
}
