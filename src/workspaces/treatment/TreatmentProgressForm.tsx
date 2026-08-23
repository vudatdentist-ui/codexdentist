"use client";

import { recordTreatmentCaseProgressAction } from "@/features/treatment-progress/server/actions";
import type { TreatmentParticipantOption } from "@/features/treatment-progress/server/get-treatment-participants";
import type { TreatmentCaseListItem } from "./get-treatment-cases-workspace";
import styles from "./treatment-progress-form.module.css";

export function TreatmentProgressForm({
  treatmentCase,
  patientId,
  participants,
  currentUserId,
}: {
  treatmentCase: TreatmentCaseListItem;
  patientId: string;
  participants: TreatmentParticipantOption[];
  currentUserId: string;
}) {
  const targets = progressTargets(treatmentCase);
  const defaultOperatorId = participants.some((item) => item.id === currentUserId)
    ? currentUserId
    : participants[0]?.id ?? "";
  const defaultConsultantId = participants.some(
    (item) => item.id === treatmentCase.createdById,
  )
    ? treatmentCase.createdById
    : "";

  if (
    treatmentCase.status === "COMPLETED" ||
    treatmentCase.status === "CANCELLED" ||
    targets.length === 0
  ) {
    return null;
  }

  return (
    <section className={styles.shell} aria-label="Ghi nhận tiến độ điều trị">
      <div className={styles.heading}>
        <div>
          <span>Thực hiện</span>
          <strong>Ghi nhận tiến độ</strong>
        </div>
        <span>{Math.round(treatmentCase.currentProgressPercent)}%</span>
      </div>

      <form action={recordTreatmentCaseProgressAction} className={styles.form} data-treatment-progress-form>
        <input name="patientId" type="hidden" value={patientId} />
        <input name="treatmentServiceId" type="hidden" value={treatmentCase.id} />

        <div className={styles.primaryRow}>
          <label>
            <span>Bước tiếp theo</span>
            <select defaultValue={String(targets[0].value)} name="toProgressPercent" required>
              {targets.map((target) => (
                <option key={`${target.value}-${target.label}`} value={target.value}>
                  {target.label} · {target.value}%
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Người thực hiện</span>
            <select defaultValue={defaultOperatorId} name="performedById" required>
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.fullName} · {roleLabel(participant.role)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={styles.noteField}>
          <span>Ghi chú</span>
          <textarea name="note" placeholder="Nội dung đã thực hiện" rows={2} />
        </label>

        <details className={styles.teamDetails}>
          <summary>Ê-kíp</summary>
          <div className={styles.teamGrid}>
            <ParticipantSelect
              defaultValue={defaultConsultantId}
              label="Tư vấn"
              name="consultantId"
              participants={participants}
            />
            <ParticipantSelect
              label="Hỗ trợ lâm sàng"
              name="clinicalSupportId"
              participants={participants}
            />
            <ParticipantSelect
              label="Phụ tá chính"
              name="assistantPrimaryId"
              participants={participants}
            />
            <ParticipantSelect
              label="Phụ tá phụ"
              name="assistantSecondaryId"
              participants={participants}
            />
          </div>
        </details>

        <div className={styles.actions}>
          <span>Ghi nhận sẽ cập nhật tiến độ, vật tư và thu nhập liên quan.</span>
          <button type="submit">Ghi nhận</button>
        </div>
      </form>
    </section>
  );
}

function ParticipantSelect({
  label,
  name,
  participants,
  defaultValue = "",
}: {
  label: string;
  name: string;
  participants: TreatmentParticipantOption[];
  defaultValue?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select defaultValue={defaultValue} name={name}>
        <option value="">—</option>
        {participants.map((participant) => (
          <option key={participant.id} value={participant.id}>
            {participant.fullName} · {roleLabel(participant.role)}
          </option>
        ))}
      </select>
    </label>
  );
}

function progressTargets(treatmentCase: TreatmentCaseListItem) {
  const seen = new Set<number>();
  const targets = treatmentCase.steps.flatMap((step) => {
    if (
      step.defaultProgress === null ||
      step.defaultProgress <= treatmentCase.currentProgressPercent ||
      step.defaultProgress > 100
    ) {
      return [];
    }

    const value = Math.round(step.defaultProgress);

    if (seen.has(value)) {
      return [];
    }

    seen.add(value);
    return [{ value, label: step.name }];
  });

  if (treatmentCase.currentProgressPercent < 100 && !seen.has(100)) {
    targets.push({ value: 100, label: "Hoàn tất" });
  }

  return targets;
}

function roleLabel(role: string) {
  switch (role) {
    case "OWNER":
      return "Chủ phòng khám";
    case "AREA_MANAGER":
      return "Quản lý vùng";
    case "CLINIC_MANAGER":
      return "Quản lý";
    case "DENTIST":
      return "Bác sĩ";
    case "HYGIENIST":
      return "Điều trị viên";
    case "FRONT_DESK":
      return "Lễ tân";
    case "BILLING":
      return "Tài chính";
    default:
      return role;
  }
}
