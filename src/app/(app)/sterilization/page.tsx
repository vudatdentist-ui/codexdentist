import { notFound } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { listSterilizationCyclesCommand } from "@/lib/application/sterilization/commands";
import { requireSession } from "@/lib/auth";
import styles from "./sterilization.module.css";

const labels: Record<string, string> = { PREPARING: "Đang chuẩn bị", RUNNING: "Đang chạy", PASSED: "Đạt", FAILED: "Không đạt", RELEASED: "Đã phát hành" };

export default async function SterilizationPage() {
  const session = await requireSession();
  if (!canPerformAction(session, "sterilization.view")) notFound();
  const cycles = await listSterilizationCyclesCommand(session);
  return <main className={styles.page}><header className={styles.header}><div><p className={styles.eyebrow}>Codexdentist · Vận hành</p><h1>Vô trùng dụng cụ</h1><p className={styles.lede}>Theo dõi từng chu kỳ và danh sách dụng cụ đi cùng một load.</p></div><a className={styles.backLink} href="/inventory">Về kho</a></header>{cycles.length === 0 ? <section className={styles.empty}><h2>Chưa có chu kỳ</h2><p>Tạo chu kỳ từ API sau khi chọn các dụng cụ đang hoạt động.</p></section> : <section className={styles.grid} aria-label="Danh sách chu kỳ vô trùng">{cycles.map((cycle) => <article className={styles.card} key={cycle.id}><div className={styles.topline}><strong>{cycle.cycleNo}</strong><span>{labels[cycle.status] ?? cycle.status}</span></div><h2>{cycle.method}</h2><p className={styles.meta}>{cycle.machineName || "Chưa chỉ định máy"}</p><p className={styles.instruments}>{cycle.instruments.map((item) => `${item.instrument.code} · ${item.instrument.name}`).join("; ")}</p><p className={styles.date}>Tạo lúc {formatDate(cycle.createdAt)}</p></article>)}</section>}</main>;
}

function formatDate(value: Date) { return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(value); }
