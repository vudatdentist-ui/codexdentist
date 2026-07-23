import { notFound } from "next/navigation";
import { FormTemplatePrintActions } from "@/components/FormTemplatePrintActions";
import { requireViewSession } from "@/lib/auth";
import { getPrintableFormTemplate } from "@/lib/forms";

export default async function FormTemplatePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ patientId?: string }>;
}) {
  const session = await requireViewSession("forms");
  const { templateId } = await params;
  const { patientId } = await searchParams;
  const form = await getPrintableFormTemplate(
    session,
    decodeURIComponent(templateId),
    patientId ? decodeURIComponent(patientId) : null,
  );

  if (!form) {
    notFound();
  }

  return (
    <main className="print-page">
      <style>{`
        body { background: #f5f7fb; color: #101828; font-family: Arial, sans-serif; }
        .print-page { max-width: 820px; margin: 32px auto; background: white; padding: 40px; border: 1px solid #d0d5dd; }
        .print-actions { display: flex; gap: 10px; margin-bottom: 18px; }
        .print-actions a, .print-actions button { min-height: 36px; border-radius: 8px; border: 1px solid #d0d5dd; background: white; color: #101828; padding: 0 12px; font-weight: 700; text-decoration: none; }
        .print-actions button { background: #0f766e; border-color: #0f766e; color: white; }
        header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #101828; padding-bottom: 18px; }
        h1 { margin: 0; font-size: 26px; }
        h2 { font-size: 15px; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
        p { margin: 4px 0; }
        .muted { color: #667085; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
        .box { border: 1px solid #d0d5dd; padding: 12px; min-height: 104px; }
        .line { border-bottom: 1px dotted #98a2b3; min-height: 22px; }
        .form-body { border: 1px solid #d0d5dd; padding: 16px; line-height: 1.6; min-height: 220px; white-space: pre-wrap; }
        .signature-row { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 56px; }
        .signature-row div { min-height: 112px; border-top: 1px solid #101828; padding-top: 8px; text-align: center; }
        @media print { body { background: white; } .print-page { margin: 0; border: 0; max-width: none; } .print-actions { display: none; } }
      `}</style>

      <FormTemplatePrintActions />

      <header>
        <div>
          <p className="muted">{form.organizationName}</p>
          <h1>{form.templateName}</h1>
          <p>{form.clinicName} - {form.clinicCity}</p>
        </div>
        <div>
          <p><strong>{form.templateCode} v{form.templateVersion}</strong></p>
          <p className="muted">{form.templateType}</p>
          <p className="muted">Ngày in: {form.printedAt}</p>
        </div>
      </header>

      <section className="grid">
        <div className="box">
          <h2>Bệnh nhân</h2>
          <p>Họ tên</p>
          <div className="line">{form.patientName}</div>
          <p>Tuổi</p>
          <div className="line">{form.patientAge}</div>
          <p>Điện thoại</p>
          <div className="line">{form.patientPhone}</div>
        </div>
        <div className="box">
          <h2>Thông tin khám</h2>
          <p>Lý do khám / chẩn đoán</p>
          <div className="line">{form.visitReason}</div>
          <p>Địa chỉ</p>
          <div className="line">{form.patientAddress}</div>
        </div>
      </section>

      <h2>Nội dung biểu mẫu</h2>
      <section className="form-body">{form.body || " "}</section>

      {form.requiresSignature && (
        <section className="signature-row">
          <div>Bệnh nhân / người đại diện</div>
          <div>Nhân viên phòng khám</div>
        </section>
      )}
    </main>
  );
}
