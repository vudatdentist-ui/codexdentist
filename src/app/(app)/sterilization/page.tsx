import { notFound } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { listSterilizationCyclesCommand, listSterilizationInstrumentsCommand } from "@/lib/application/sterilization/commands";
import { requireSession } from "@/lib/auth";
import { allowedClinicIds } from "@/lib/patient-access";
import { OperationsWorkspaceFrame } from "@/app/(app)/OperationsWorkspaceFrame";
import { SterilizationCreateForms, SterilizationStatusForm } from "./sterilization-forms";
import { sterilizationStatusLabels } from "./labels";
import styles from "./sterilization.module.css";

export default async function SterilizationPage() {
  const session = await requireSession();
  if (!canPerformAction(session, "sterilization.view")) notFound();
  const canCreate = canPerformAction(session, "sterilization.create");
  const [cycles, instruments] = await Promise.all([
    listSterilizationCyclesCommand(session),
    canCreate ? listSterilizationInstrumentsCommand(session) : Promise.resolve([]),
  ]);
  const clinicIds = allowedClinicIds(session);
  const clinics = session.clinics.filter(clinic => clinicIds.includes(clinic.id)).map(({ id, name }) => ({ id, name }));
  const activeClinicId = session.activeClinicId && clinicIds.includes(session.activeClinicId) ? session.activeClinicId : null;
  return <OperationsWorkspaceFrame view="sterilization" session={session}><div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>{session.clinics.find(clinic => clinic.id === session.activeClinicId)?.name ?? "Các phòng khám được phép"}</p>
        <h2>Dụng cụ và lịch sử vô trùng</h2>
        <p className={styles.lede}>Theo dõi từng chu kỳ và các dụng cụ được xử lý cùng nhau.</p>
      </div>
      <a className={styles.backLink} href="/inventory">Về kho</a>
    </header>
    {canCreate && <SterilizationCreateForms instruments={instruments.filter(item => clinicIds.includes(item.clinicId))} clinics={clinics} activeClinicId={activeClinicId} />}
    {cycles.length === 0 ? <section className={styles.empty}><h2>Chưa có chu kỳ</h2><p>Lịch sử xử lý và kết quả kiểm tra dụng cụ sẽ xuất hiện tại đây.</p></section>
      : <section className={styles.grid} aria-label="Danh sách chu kỳ vô trùng">{cycles.map(cycle =>
        <article className={styles.card} key={cycle.id}>
          <div className={styles.topline}><strong>{cycle.cycleNo}</strong><span>{sterilizationStatusLabels[cycle.status] ?? cycle.status}</span></div>
          <h2>{cycle.method}</h2>
          <p className={styles.meta}>{cycle.machineName || "Chưa chỉ định máy"}</p>
          <p className={styles.instruments}>{cycle.instruments.map(item => `${item.instrument.code} · ${item.instrument.name}`).join("; ")}</p>
          <p className={styles.date}>Tạo lúc {formatDate(cycle.createdAt)}</p>
          {canPerformAction(session, "sterilization.update") && <SterilizationStatusForm id={cycle.id} status={cycle.status} />}
        </article>)}</section>}
  </div></OperationsWorkspaceFrame>;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(value);
}
