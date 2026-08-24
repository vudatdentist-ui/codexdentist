"use client";

import { useMemo, useState } from "react";
import {
  createJourneyTreatmentServicesAction,
  deleteJourneyTreatmentServiceAction,
  recordJourneyServiceProgressAction,
  updateJourneyTreatmentServiceDiscountAction,
} from "@/features/patient-360/server/journey-actions";
import { PatientOdontogramEditor } from "@/components/PatientOdontogramEditor";
import { formatVnd, type Patient } from "@/lib/data";
import { hasAnyRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import type { TreatmentServiceSummary } from "@/lib/services-types";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import { serviceProgressLabel, serviceProgressOptions } from "./patient-360-helpers";
import native from "./patient-360-native.module.css";

type PendingProgress = {
  service: TreatmentServiceSummary;
  toProgressPercent: number;
};

const archTargets = [
  ["ARCH_UPPER", "Hàm trên"],
  ["ARCH_LOWER", "Hàm dưới"],
  ["ARCH_BOTH", "Hai hàm"],
  ["TOOTH_GROUP", "Nhóm răng"],
] as const;

export function PatientTreatmentSection({
  model,
  patient,
  session,
}: {
  model: Patient360WorkspaceModel;
  patient: Patient;
  session: AppSession;
}) {
  const [toothTargets, setToothTargets] = useState<string[]>([]);
  const [archTarget, setArchTarget] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [serviceCatalogItemId, setServiceCatalogItemId] = useState("");
  const [pendingProgress, setPendingProgress] = useState<PendingProgress | null>(null);
  const odontogram = model.journeyRecordsWorkspace?.odontograms.find((item) => item.patientId === patient.id) ?? null;
  const services = model.servicesWorkspace?.treatmentServices.filter((service) => service.patientId === patient.id) ?? [];
  const catalog = model.servicesWorkspace?.services.filter((service) => service.status === "ACTIVE") ?? [];
  const canEditOdontogram = Boolean(
    model.journeyRecordsWorkspace?.source === "database" &&
      hasAnyRole(session, ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"]),
  );
  const canPlan = Boolean(
    model.servicesWorkspace?.source === "database" &&
      model.servicesWorkspace.canMutate &&
      hasAnyRole(session, ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST"]),
  );
  const canDelete = hasAnyRole(session, ["OWNER"]);
  const targets = useMemo(() => {
    if (archTarget === "TOOTH_GROUP") return toothTargets;
    if (archTarget) return [archTarget];
    return toothTargets;
  }, [archTarget, toothTargets]);
  const selectedCatalog = catalog.find((service) => service.id === serviceCatalogItemId) ?? null;
  const participants = model.settingsWorkspace?.staff.filter(
    (member) =>
      member.active &&
      member.roleAssignments.some(
        (assignment) =>
          assignment.active &&
          assignment.role !== "PATIENT" &&
          (assignment.clinicId === null || assignment.clinicId === pendingProgress?.service.clinicId),
      ),
  ) ?? [];

  return (
    <section className={native.stack} id="patient-treatment">
      <section className={native.card}>
        <header className={native.cardHeader}>
          <div>
            <h2>Odontogram</h2>
            <p>Ba stage INITIAL / CURRENT / EXPECTED giữ revision độc lập; vùng chọn dưới đây chỉ dùng để tạo dịch vụ.</p>
          </div>
          <span className={native.badge}>{canEditOdontogram ? "Có quyền sửa" : "Chỉ xem"}</span>
        </header>

        <PatientOdontogramEditor
          canEdit={canEditOdontogram}
          initialOdontogram={odontogram}
          language="vi"
          onSelectionChange={(teeth) => setToothTargets(teeth.map((tooth) => `R${tooth}`))}
          patientId={patient.id}
          selectedTeeth={toothTargets.map((target) => target.replace(/^R/, ""))}
          chartFooter={
            <div>
              <div className={native.targetRow}>
                {archTargets.map(([value, label]) => (
                  <button
                    data-active={archTarget === value}
                    key={value}
                    onClick={() => setArchTarget((current) => current === value ? "" : value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <form action={createJourneyTreatmentServicesAction} className={native.formGrid}>
                <input name="patientId" type="hidden" value={patient.id} />
                <input name="targets" type="hidden" value={targets.join("\n")} />
                <label>
                  Chẩn đoán / mục tiêu
                  <input name="diagnosis" onChange={(event) => setDiagnosis(event.target.value)} value={diagnosis} />
                </label>
                <label>
                  Dịch vụ
                  <select
                    name="serviceCatalogItemId"
                    onChange={(event) => setServiceCatalogItemId(event.target.value)}
                    value={serviceCatalogItemId}
                  >
                    <option value="">Chọn dịch vụ</option>
                    {catalog.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.code} · {service.name} · {formatVnd(service.defaultPrice)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={`${native.actions} ${native.wide}`}>
                  <button
                    className={native.button}
                    disabled={!canPlan || !selectedCatalog || targets.length === 0}
                    type="submit"
                  >
                    Thêm dịch vụ điều trị
                  </button>
                </div>
              </form>
            </div>
          }
        />
      </section>

      <section className={native.card} id="patient-services">
        <header className={native.cardHeader}>
          <div>
            <h2>Dịch vụ điều trị</h2>
            <p>Tiến độ chỉ đi tới; hoạt động tài chính khóa giảm giá và xóa trực tiếp.</p>
          </div>
          <span className={native.badge}>{services.length} dịch vụ</span>
        </header>

        {services.length > 0 ? (
          <div className={native.serviceList}>
            {services.map((service) => {
              const discount = Math.max(service.listPrice - service.finalPrice, 0);
              const financiallyLocked = service.invoicedAmount > 0 || service.collectedAmount > 0 || service.creditAllocatedAmount > 0;
              const deleteLocked = financiallyLocked || service.currentProgressPercent > 0 || service.progressEvents.length > 0 || service.status !== "PLANNED";
              const progressOptions = serviceProgressOptions(service.currentProgressPercent, service.steps);
              const targetLabel = service.targetSummary ?? (service.teeth.join(", ") || "Chưa ghi mục tiêu");

              return (
                <article className={native.service} key={service.id}>
                  <div className={native.serviceHeader}>
                    <div>
                      <strong>{service.serviceCode} · {service.serviceName}</strong>
                      <p>{targetLabel}</p>
                    </div>
                    <span className={native.badge}>{serviceProgressLabel(service.currentProgressPercent, service.status, service.steps)}</span>
                  </div>
                  <div className={native.serviceMetrics}>
                    <span>Giá niêm yết<strong>{formatVnd(service.listPrice)}</strong></span>
                    <span>Giảm giá<strong>{formatVnd(discount)}</strong></span>
                    <span>Giá cuối<strong>{formatVnd(service.finalPrice)}</strong></span>
                    <span>Đã thu/phân bổ<strong>{formatVnd(service.collectedAmount + service.creditAllocatedAmount)}</strong></span>
                  </div>
                  <div className={native.progressTrack}>
                    <span style={{ width: `${Math.min(Math.max(service.currentProgressPercent, 0), 100)}%` }} />
                  </div>
                  <div className={native.actions}>
                    {service.status !== "CANCELLED" && service.currentProgressPercent < 100 ? (
                      <select
                        aria-label={`Tiến độ ${service.serviceCode}`}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value > service.currentProgressPercent) {
                            setPendingProgress({ service, toProgressPercent: value });
                          }
                        }}
                        value={String(Math.round(service.currentProgressPercent))}
                      >
                        {progressOptions.map((percent) => (
                          <option key={percent} value={percent}>
                            {serviceProgressLabel(percent, undefined, service.steps)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {!financiallyLocked ? (
                      <form action={updateJourneyTreatmentServiceDiscountAction} className={native.actions}>
                        <input name="patientId" type="hidden" value={patient.id} />
                        <input name="treatmentServiceId" type="hidden" value={service.id} />
                        <input aria-label={`Giảm giá ${service.serviceCode}`} name="discount" defaultValue={String(discount)} inputMode="numeric" />
                        <button className={native.buttonSecondary} type="submit">Lưu giảm giá</button>
                      </form>
                    ) : null}
                    {canDelete ? (
                      <form action={deleteJourneyTreatmentServiceAction}>
                        <input name="patientId" type="hidden" value={patient.id} />
                        <input name="treatmentServiceId" type="hidden" value={service.id} />
                        <button className={native.buttonDanger} disabled={deleteLocked} type="submit">Xóa</button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className={native.empty}>Chưa có dịch vụ điều trị cho bệnh nhân này.</p>
        )}
      </section>

      {pendingProgress ? (
        <div className={native.modalBackdrop} onClick={() => setPendingProgress(null)} role="presentation">
          <form action={recordJourneyServiceProgressAction} className={native.modal} onClick={(event) => event.stopPropagation()}>
            <header className={native.modalHeader}>
              <div>
                <span className={native.meta}>{pendingProgress.service.serviceCode}</span>
                <h3>Ghi nhận tiến độ · {pendingProgress.toProgressPercent}%</h3>
              </div>
              <button className={native.buttonSecondary} onClick={() => setPendingProgress(null)} type="button">Đóng</button>
            </header>
            <input name="treatmentServiceId" type="hidden" value={pendingProgress.service.id} />
            <input name="patientId" type="hidden" value={patient.id} />
            <input name="toProgressPercent" type="hidden" value={pendingProgress.toProgressPercent} />
            <div className={native.formGrid}>
              <label>Người tư vấn<select name="consultantId" defaultValue={pendingProgress.service.createdById}><option value="">Không chọn</option>{participants.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label>Người thực hiện<select name="performedById" defaultValue={session.userId}>{participants.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label>Hỗ trợ chuyên môn<select name="clinicalSupportId" defaultValue=""><option value="">Không chọn</option>{participants.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label>Phụ tá 1<select name="assistantPrimaryId" defaultValue=""><option value="">Không chọn</option>{participants.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label>Phụ tá 2<select name="assistantSecondaryId" defaultValue=""><option value="">Không chọn</option>{participants.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
              <label className={native.wide}>Ghi chú<textarea name="note" /></label>
            </div>
            <div className={native.actions}>
              <button className={native.buttonSecondary} onClick={() => setPendingProgress(null)} type="button">Hủy</button>
              <button className={native.button} type="submit">Ghi nhận tiến độ</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
