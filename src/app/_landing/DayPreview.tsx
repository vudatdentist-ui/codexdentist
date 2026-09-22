"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, CalendarDays, Check, ClipboardList, Clock3, HeartPulse, LayoutGrid, ReceiptText } from "lucide-react";
import styles from "./landing.module.css";

const chapters = [
  { time: "08:00", label: "Đón tiếp", title: "Sẵn sàng cho ngày mới.", role: "Lễ tân", icon: CalendarDays },
  { time: "10:30", label: "Điều trị", title: "Một hồ sơ. Cả hành trình.", role: "Bác sĩ", icon: HeartPulse },
  { time: "17:00", label: "Tiếp nối", title: "Khép lại một buổi khám.", role: "Quản lý", icon: ReceiptText },
] as const;

export function DayPreview() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const chapter = chapters[active];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = event.key === "ArrowRight" ? (index + 1) % chapters.length
      : event.key === "ArrowLeft" ? (index + chapters.length - 1) % chapters.length
      : event.key === "Home" ? 0 : event.key === "End" ? chapters.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    setActive(target);
    tabs.current[target]?.focus();
  }

  return (
    <div className={styles.preview}>
      <div className={styles.previewLabel}><span>Một ngày cùng Codexdentist</span><span>0{active + 1} / 03</span></div>
      <div className={styles.previewCanvas}>
        <div className={styles.appWindow}>
          <div className={styles.appToolbar}>
            <span className={styles.appIdentity}><img src="/icons/codexmed-icon.svg" alt="" width="22" height="22" /> Phòng khám của bạn</span>
            <span className={styles.roleLabel}>{chapter.role}</span>
          </div>
          <div className={styles.appBody}>
            <div className={styles.appSidebar} aria-hidden="true"><LayoutGrid size={19} /><CalendarDays size={19} /><HeartPulse size={19} /><ReceiptText size={19} /></div>
            <section className={styles.appPanel} role="tabpanel" id="day-panel" aria-labelledby={`day-tab-${active}`} tabIndex={0}>
              <p className={styles.appEyebrow}>{chapter.time} <span>/</span> {chapter.label}</p>
              <h2>{chapter.title}</h2>
              {active === 0 && <div className={styles.agenda}>
                <div className={styles.agendaHeading}><span>Lịch hẹn hôm nay</span><CalendarDays size={15} aria-hidden="true" /></div>
                {[
                  ["08:30", "Khám tổng quát", "Lượt hẹn 01 · Ghế 01", "Đã đến"],
                  ["09:00", "Tái khám", "Lượt hẹn 02 · Ghế 02", "Đã xác nhận"],
                  ["09:30", "Tư vấn điều trị", "Lượt hẹn 03 · Ghế 01", "Đã xác nhận"],
                ].map(([time, title, subtitle, status], i) => <div className={styles.appointment} key={time} data-current={i === 0}>
                  <time>{time}</time><div><strong>{title}</strong><small>{subtitle}</small></div><span className={styles.appointmentStatus}>{status}</span>
                </div>)}
                <div className={styles.previewNote}><Clock3 size={15} aria-hidden="true" /> Cùng nắm lịch. Cùng chủ động.</div>
              </div>}
              {active === 1 && <div className={styles.journeyPreview}>
                <div className={styles.fileHeading}><span className={styles.patientSymbol}><ClipboardList size={23} aria-hidden="true" /></span><div><strong>Hồ sơ điều trị</strong><small>Journey · Lượt hẹn minh hoạ</small></div></div>
                <div className={styles.clinicalTrail}>
                  <div><span /><section><strong>Khám ban đầu</strong><p>Ghi nhận tình trạng và ghi chú lâm sàng.</p></section><Check size={16} aria-hidden="true" /></div>
                  <div><span /><section><strong>Kế hoạch điều trị</strong><p>Dịch vụ và tiến trình trên cùng hồ sơ.</p></section><Check size={16} aria-hidden="true" /></div>
                  <div><span /><section><strong>Buổi hẹn tiếp theo</strong><p>Tiếp nối từ lịch sử đã ghi nhận.</p></section><ArrowRight size={16} aria-hidden="true" /></div>
                </div>
              </div>}
              {active === 2 && <div className={styles.checkoutPreview}>
                <span className={styles.receiptIcon}><ReceiptText size={30} aria-hidden="true" /></span>
                <strong>Rõ ràng trước khi hẹn lại.</strong>
                <p>Từ dịch vụ đã thực hiện đến lần chăm sóc tiếp theo.</p>
                {["Kiểm tra dịch vụ", "Ghi nhận thu tiền và hoá đơn", "Đặt lịch hẹn tiếp theo"].map(label => <div key={label}><Check size={16} aria-hidden="true" /><span>{label}</span></div>)}
              </div>}
            </section>
          </div>
          <div className={styles.windowFooter}><span className={styles.statusDot} /> Bản xem trước <span>Dữ liệu minh hoạ</span></div>
        </div>
      </div>
      <div className={styles.dayTabs} role="tablist" aria-label="Khám phá ba thời điểm trong ngày">
        {chapters.map(({ time, label, icon: Icon }, index) => <button key={time} type="button" role="tab"
          id={`day-tab-${index}`} aria-controls="day-panel" aria-selected={active === index} tabIndex={active === index ? 0 : -1}
          ref={element => { tabs.current[index] = element; }} onClick={() => setActive(index)} onKeyDown={event => navigate(event, index)}>
          <span><Icon size={16} aria-hidden="true" />{time}</span><strong>{label}</strong>
        </button>)}
      </div>
    </div>
  );
}
