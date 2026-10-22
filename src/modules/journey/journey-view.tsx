"use client";
import { PatientOverviewSection } from "./PatientOverviewSection";
import { OdontogramSection } from "./OdontogramSection";
import { TreatmentServicesSection } from "./TreatmentServicesSection";
import { JourneyTimelineSection } from "./JourneyTimelineSection";
import { TreatmentProgressDialog } from "./TreatmentProgressDialog";
import { RecordSectionNav } from "@/components/ui/RecordSectionNav";
import { EmptyState } from "@/components/suite-primitives";
import type { PatientJourneyPanelModel } from "./journey-model";
export function PatientJourneyPanelView(model: PatientJourneyPanelModel) {
    const { jt, notice, selectedPatient, openTimelineImage, setOpenTimelineImage, pendingProgressUpdate, messages, searchSummary, } = model;
    return (<section className="view-stack patient-chart">
      <div className="chart-search-meta patient-chart-search-meta">
        <span>{searchSummary}</span>
      </div>

      {(notice || messages.length > 0) && (<div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? messages[0]}
        </div>)}

      {selectedPatient ? (<section className="patient-chart-flow">
          <RecordSectionNav label={jt.chart.sectionNavAria} items={[
                { id: "chart-admin", label: jt.nav.admin },
                { id: "chart-note", label: jt.nav.exam },
                { id: "chart-odontogram", label: jt.nav.odontogram },
                { id: "chart-services", label: jt.nav.services },
                { id: "chart-timeline", label: jt.nav.timeline },
            ]}/>
          <PatientOverviewSection {...model}/>

          <OdontogramSection {...model}/>

          <TreatmentServicesSection {...model}/>

          <JourneyTimelineSection {...model}/>
        </section>) : (<EmptyState label={jt.chart.noPatient}/>)}

      {pendingProgressUpdate && selectedPatient && (<TreatmentProgressDialog {...model}/>)}

      {openTimelineImage && (<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={openTimelineImage.alt} onClick={() => setOpenTimelineImage(null)}>
          <div className="image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button className="icon-button image-lightbox-close" type="button" onClick={() => setOpenTimelineImage(null)} aria-label={jt.timeline.closeImage}>
              ×
            </button>
            <img src={openTimelineImage.src} alt={openTimelineImage.alt}/>
            <span>{openTimelineImage.alt}</span>
          </div>
        </div>)}
    </section>);
}
