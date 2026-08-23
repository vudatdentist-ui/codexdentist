"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatVnd } from "@/lib/data";
import type {
  TreatmentCaseListItem,
  TreatmentCasesWorkspaceModel,
} from "./get-treatment-cases-workspace";
import { TreatmentProgressForm } from "./TreatmentProgressForm";
import styles from "./treatment-cases-workspace.module.css";

export function TreatmentCasesExperience({
  model,
}: {
  model: TreatmentCasesWorkspaceModel;
}) {
  if (model.treatmentCase && model.patient) {
    return <TreatmentCase model={model} treatmentCase={model.treatmentCase} />;
  }

  return <TreatmentDirectory model={model} />;
}

function TreatmentDirectory({ model }: { model: TreatmentCasesWorkspaceModel }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearch(query);
  const cases = useMemo(() => {
    if (!normalizedQuery) {
      return model.cases;
    }

    return model.cases.filter((treatmentCase) =>
      [
        treatmentCase.patientName,
        treatmentCase.patientCode,
        treatmentCase.serviceCode,
        treatmentCase.serviceName,
        treatmentCase.targetSummary,
        treatmentCase.teeth.join(" "),
      ].some((value) => normalizeSearch(value).includes(normalizedQuery)),
    );
  }, [model.cases, normalizedQuery]);

  return (
    <div className={styles.page}>
      <header className={styles.directoryHeader}>
        <div>
          <span className={styles.eyebrow}>Điều trị</span>
          <h1>Ca điều trị</h1>
          <p>{model.cases.length} dịch vụ đang nằm trong phạm vi hiện tại</p>
        </div>
      </header>

      {model.message && <p className={styles.notice}>{model.message}</p>}

      <label className={styles.searchField}>
        <span>Tìm ca</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Bệnh nhân, dịch vụ, mã ca, răng..."
          type="search"
          value={query}
        />
      </label>

      <section className={styles.caseList} aria-label="Danh sách ca điều trị">
        <div className={styles.listHeader}>
          <span>{normalizedQuery ? "Kết quả" : "Tất cả ca"}</span>
          <span>{cases.length}</span>
        </div>

        {cases.length > 0 ? (
          <div className={styles.caseRows}>
            {cases.map((treatmentCase) => (
              <Link
                className={styles.caseRow}
                data-treatment-case-link
                href={treatmentCaseHref(treatmentCase)}
                key={treatmentCase.id}
              >
                <div className={styles.caseIdentity}>
                  <strong>{treatmentCase.serviceName}</strong>
                  <span>
                    {treatmentCase.serviceCode}
                    {treatmentCase.teeth.length > 0
                      ? ` · ${treatmentCase.teeth.join(", ")}`
                      : ""}
                  </span>
                </div>
                <div className={styles.patientIdentity}>
                  <strong>{treatmentCase.patientName}</strong>
                  <span>{treatmentCase.patientCode ?? "Hồ sơ bệnh nhân"}</span>
                </div>
                <span className={styles.rowProgress}>
                  {Math.round(treatmentCase.currentProgressPercent)}%
                </span>
                <span className={styles.rowState}>
                  {statusLabel(treatmentCase.status)}
                </span>
                <span className={styles.openAction}>Mở ca →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>Không tìm thấy ca điều trị phù hợp.</p>
        )}
      </section>
    </div>
  );
}

function TreatmentCase({
  model,
  treatmentCase,
}: {
  model: TreatmentCasesWorkspaceModel;
  treatmentCase: TreatmentCaseListItem;
}) {
  const patient = model.patient!;
  const currentStepIndex = resolveCurrentStepIndex(treatmentCase);
  const outstanding = Math.max(
    treatmentCase.finalPrice - treatmentCase.collectedAmount - treatmentCase.creditAllocatedAmount,
    0,
  );
  const latestClinicalNotes = model.clinicalNotes.slice(0, 4);

  return (
    <article className={styles.casePage}>
      <header className={styles.caseHeader}>
        <div className={styles.caseHeaderMain}>
          <div className={styles.caseBreadcrumbs}>
            <Link href="/treatment">← Điều trị</Link>
            <span>/</span>
            <Link href={`/patients/${encodeURIComponent(patient.id)}`}>
              {patient.name}
            </Link>
          </div>
          <span className={styles.eyebrow}>Ca điều trị</span>
          <h1>{treatmentCase.serviceName}</h1>
          <p>
            {treatmentCase.serviceCode}
            {treatmentCase.targetSummary ? ` · ${treatmentCase.targetSummary}` : ""}
            {treatmentCase.teeth.length > 0
              ? ` · ${treatmentCase.teeth.join(", ")}`
              : ""}
          </p>
        </div>

        <div className={styles.caseHeaderActions}>
          <span className={styles.status}>{statusLabel(treatmentCase.status)}</span>
          <Link
            className={styles.secondaryAction}
            href={`/patients/${encodeURIComponent(patient.id)}`}
          >
            Mở hồ sơ bệnh nhân
          </Link>
        </div>
      </header>

      <section className={styles.progressSummary} aria-label="Tiến độ hiện tại">
        <div className={styles.progressNumber}>
          <strong>{Math.round(treatmentCase.currentProgressPercent)}%</strong>
          <span>Tiến độ</span>
        </div>
        <div className={styles.progressTrack} aria-hidden="true">
          <span
            style={{ width: `${Math.min(Math.max(treatmentCase.currentProgressPercent, 0), 100)}%` }}
          />
        </div>
      </section>

      {model.canProgress && (
        <TreatmentProgressForm
          currentUserId={model.currentUserId}
          participants={model.participants}
          patientId={patient.id}
          treatmentCase={treatmentCase}
        />
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Tiến trình</h2>
          <span>{treatmentCase.steps.length} bước</span>
        </div>

        {treatmentCase.steps.length > 0 ? (
          <ol className={styles.steps}>
            {treatmentCase.steps.map((step, index) => {
              const state = stepState(
                treatmentCase,
                index,
                currentStepIndex,
              );

              return (
                <li className={styles.step} data-state={state} key={step.id}>
                  <span className={styles.stepMarker} aria-hidden="true">
                    {state === "done" ? "✓" : state === "current" ? "●" : "○"}
                  </span>
                  <div className={styles.stepBody}>
                    <div>
                      <strong>{step.name}</strong>
                      {step.description && <p>{step.description}</p>}
                    </div>
                    <div className={styles.stepMeta}>
                      {step.defaultProgress !== null && (
                        <span>{Math.round(step.defaultProgress)}%</span>
                      )}
                      {step.expectedMinutes !== null && (
                        <span>{step.expectedMinutes} phút</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.emptyInline}>Dịch vụ này chưa có bước chuẩn.</p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Lịch sử tiến độ</h2>
          <span>{treatmentCase.progressEvents.length} gần nhất</span>
        </div>

        {treatmentCase.progressEvents.length > 0 ? (
          <div className={styles.eventRows}>
            {treatmentCase.progressEvents.map((event) => (
              <div className={styles.eventRow} key={event.id}>
                <time dateTime={event.occurredAtIso}>{event.occurredAt}</time>
                <div className={styles.eventMain}>
                  <strong>
                    {Math.round(event.fromProgressPercent)}% → {Math.round(event.toProgressPercent)}%
                  </strong>
                  <span>
                    {event.performedByName}
                    {event.consultantName ? ` · Tư vấn: ${event.consultantName}` : ""}
                    {event.assistantPrimaryName
                      ? ` · Phụ tá: ${event.assistantPrimaryName}`
                      : ""}
                  </span>
                  {event.note && <p>{event.note}</p>}
                </div>
                <span className={styles.eventEconomics}>
                  {event.totalCompensationAmount > 0
                    ? `${formatVnd(event.totalCompensationAmount)} thu nhập`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyInline}>Chưa có lần ghi nhận tiến độ.</p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Tài chính</h2>
          <span>{outstanding > 0 ? `Còn ${formatVnd(outstanding)}` : "Đã cân đối"}</span>
        </div>
        <dl className={styles.factRows}>
          <div>
            <dt>Giá dịch vụ</dt>
            <dd>{formatVnd(treatmentCase.finalPrice)}</dd>
          </div>
          <div>
            <dt>Đã thu</dt>
            <dd>{formatVnd(treatmentCase.collectedAmount)}</dd>
          </div>
          <div>
            <dt>Credit đã phân bổ</dt>
            <dd>{formatVnd(treatmentCase.creditAllocatedAmount)}</dd>
          </div>
          <div>
            <dt>Đã xuất hóa đơn</dt>
            <dd>{formatVnd(treatmentCase.invoicedAmount)}</dd>
          </div>
          {treatmentCase.invoiceNos.length > 0 && (
            <div>
              <dt>Hóa đơn</dt>
              <dd>{treatmentCase.invoiceNos.join(", ")}</dd>
            </div>
          )}
        </dl>
      </section>

      {model.canViewClinical && (
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Lâm sàng</h2>
            <Link href={`/patients/${encodeURIComponent(patient.id)}`}>Toàn bộ hồ sơ →</Link>
          </div>

          {latestClinicalNotes.length > 0 ? (
            <div className={styles.clinicalRows}>
              {latestClinicalNotes.map((note) => (
                <div className={styles.clinicalRow} key={note.id}>
                  <div>
                    <time dateTime={note.createdAtIso ?? undefined}>{note.createdAt}</time>
                    <span>{note.author}</span>
                  </div>
                  <div>
                    <strong>{note.assessment || note.objective || "Ghi nhận lâm sàng"}</strong>
                    {note.plan && <p>{note.plan}</p>}
                  </div>
                  <span>{note.lockedAt ? "Đã ký" : "Chưa ký"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyInline}>Chưa có ghi nhận lâm sàng cho bệnh nhân này.</p>
          )}
        </section>
      )}
    </article>
  );
}

function treatmentCaseHref(treatmentCase: TreatmentCaseListItem) {
  return `/patients/${encodeURIComponent(treatmentCase.patientId)}/treatments/${encodeURIComponent(treatmentCase.id)}`;
}

function resolveCurrentStepIndex(treatmentCase: TreatmentCaseListItem) {
  if (treatmentCase.steps.length === 0) {
    return -1;
  }

  if (treatmentCase.currentProgressPercent >= 100) {
    return treatmentCase.steps.length;
  }

  const explicitIndex = treatmentCase.currentStepSequence
    ? treatmentCase.steps.findIndex(
        (step) => step.sequence === treatmentCase.currentStepSequence,
      )
    : -1;

  if (explicitIndex >= 0) {
    return explicitIndex;
  }

  const nextIndex = treatmentCase.steps.findIndex(
    (step) =>
      step.defaultProgress !== null &&
      step.defaultProgress > treatmentCase.currentProgressPercent,
  );

  return nextIndex >= 0 ? nextIndex : treatmentCase.steps.length - 1;
}

function stepState(
  treatmentCase: TreatmentCaseListItem,
  index: number,
  currentStepIndex: number,
) {
  if (treatmentCase.currentProgressPercent >= 100 || index < currentStepIndex) {
    return "done";
  }

  if (index === currentStepIndex) {
    return "current";
  }

  return "upcoming";
}

function statusLabel(status: TreatmentCaseListItem["status"]) {
  switch (status) {
    case "PLANNED":
      return "Đã lên kế hoạch";
    case "IN_PROGRESS":
      return "Đang điều trị";
    case "COMPLETED":
      return "Hoàn tất";
    case "CANCELLED":
      return "Đã hủy";
  }
}

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase()
    .trim();
}
