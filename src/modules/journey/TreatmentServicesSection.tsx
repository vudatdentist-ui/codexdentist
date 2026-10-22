"use client";
import { Trash2, WalletCards } from "lucide-react";
import { deleteJourneyTreatmentServiceAction, updateJourneyTreatmentServiceDiscountAction } from "@/app/(app)/journey/actions";
import { MoneyInput } from "@/components/MoneyInput";
import { EmptyState, PanelHeader } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { displayStatus, serviceProgressOptions, serviceProgressIsCancelled, serviceProgressPercent, serviceProgressLabelFromPercent, serviceProgressPercentOptions, displayServiceInstanceCode, } from "./journey-shared";
import type { PatientJourneyPanelModel } from "./journey-model";
export function TreatmentServicesSection(model: Pick<PatientJourneyPanelModel, "jt" | "canDeleteTreatmentServices" | "filteredTreatmentServices" | "serviceAppliedAmount" | "visiblePatientsById" | "setPendingProgressUpdate" | "updateServiceProgress" | "language" | "updateServiceDiscount" | "submitServiceDiscountOnBlur" | "selectedPatientKey" | "removeDraftTreatmentService" | "chartSearchQuery">) {
    const { jt, canDeleteTreatmentServices, filteredTreatmentServices, serviceAppliedAmount, visiblePatientsById, setPendingProgressUpdate, updateServiceProgress, language, updateServiceDiscount, submitServiceDiscountOnBlur, selectedPatientKey, removeDraftTreatmentService, chartSearchQuery } = model;
    return (<section className="panel journey-services-panel" id="chart-services">
            <PanelHeader icon={WalletCards} title={jt.services.title} action={jt.actions.services}/>
            <div className="journey-service-table">
              <div className={canDeleteTreatmentServices
            ? "journey-service-row head with-actions"
            : "journey-service-row head"}>
                <span>{jt.services.serviceCode}</span>
                <span>{jt.services.object}</span>
                <span>{jt.services.serviceName}</span>
                <span>{jt.services.diagnosis}</span>
                <span>{jt.services.progress}</span>
                <span>{jt.services.listPrice}</span>
                <span>{jt.services.discount}</span>
                <span>{jt.services.finalPrice}</span>
                <span>{jt.services.collected}</span>
                {canDeleteTreatmentServices && <span>{jt.services.actions}</span>}
              </div>
              {filteredTreatmentServices.length > 0 ? (filteredTreatmentServices.map((service) => {
            const progressPercent = serviceProgressPercent(service.progress);
            const displayedAppliedAmount = Math.min(serviceAppliedAmount(service.id), service.finalPrice);
            const discountLocked = service.source === "database" &&
                ((service.invoicedAmount ?? 0) > 0 ||
                    (service.collectedAmount ?? 0) > 0 ||
                    (service.creditAllocatedAmount ?? 0) > 0);
            const serviceDeleteLocked = service.source === "database" &&
                (service.progress !== "Planned (0%)" ||
                    progressPercent > 0 ||
                    (service.progressEvents?.length ?? 0) > 0 ||
                    (service.invoicedAmount ?? 0) > 0 ||
                    (service.collectedAmount ?? 0) > 0 ||
                    (service.creditAllocatedAmount ?? 0) > 0);
            return (<div className={canDeleteTreatmentServices
                    ? "journey-service-row with-actions"
                    : "journey-service-row"} key={service.id}>
                      <span className="code-chip" data-label={jt.services.serviceCode}>
                        {displayServiceInstanceCode(service, visiblePatientsById.get(service.patientId))}
                      </span>
                      <span data-label={jt.services.object}>{service.object}</span>
                      <div className="journey-service-name" data-label={jt.services.serviceName}>
                        <strong>{service.serviceName}</strong>
                        {(service.createdBy || service.compensationRuleName) && (<small>
                            {service.createdBy
                        ? `${jt.services.createdBy} ${service.createdBy}`
                        : ""}
                            {service.createdBy && service.compensationRuleName
                        ? " · "
                        : ""}
                            {service.compensationRuleName ?? ""}
                          </small>)}
                      </div>
                      <span data-label={jt.services.diagnosis}>{service.diagnosis}</span>
                      {service.source === "database" ? (<div className="service-progress-cell" data-label={jt.services.progress}>
                          <select value={String(progressPercent)} onChange={(event) => {
                        const toProgressPercent = Number(event.target.value);
                        if (Number.isNaN(toProgressPercent) ||
                            toProgressPercent === progressPercent) {
                            return;
                        }
                        setPendingProgressUpdate({
                            serviceId: service.id,
                            clinicId: service.clinicId ?? "",
                            consultantId: service.createdById ?? null,
                            serviceLabel: displayServiceInstanceCode(service, visiblePatientsById.get(service.patientId)),
                            serviceName: service.serviceName,
                            fromProgressPercent: progressPercent,
                            toProgressPercent,
                            steps: service.progressSteps ?? [],
                        });
                    }}>
                            {serviceProgressPercentOptions(progressPercent, service.progressSteps).map((percent) => (<option value={percent} key={percent}>
                                {serviceProgressLabelFromPercent(percent, undefined, service.progressSteps)}
                              </option>))}
                          </select>
                        </div>) : service.source === "odontogram" ? (<div className="service-progress-cell" data-label={jt.services.progress}>
                          <select value={service.progress} onChange={(event) => updateServiceProgress(service.id, event.target.value)}>
                            {serviceProgressOptions.map((progress) => (<option value={progress} key={progress}>
                                {displayStatus(progress, language)}
                              </option>))}
                          </select>
                        </div>) : (<span data-label={jt.services.progress}>{displayStatus(service.progress, language)}</span>)}
                      <span data-label={jt.services.listPrice}>{formatVnd(service.listPrice)}</span>
                      {service.source === "odontogram" ? (<div className="journey-service-input-cell" data-label={jt.services.discount}>
                          <MoneyInput name={`discount-${service.id}`} value={service.discount} onValueChange={(amount) => updateServiceDiscount(service.id, amount)}/>
                        </div>) : service.source === "database" && !discountLocked ? (<form action={updateJourneyTreatmentServiceDiscountAction} className="journey-service-discount-form" data-label={jt.services.discount} onBlur={(event) => submitServiceDiscountOnBlur(event, service.discount)}>
                          <input name="patientId" type="hidden" value={selectedPatientKey}/>
                          <input name="treatmentServiceId" type="hidden" value={service.id}/>
                          <MoneyInput aria-label={jt.services.discount} name="discount" defaultValue={service.discount}/>
                        </form>) : (<span data-label={jt.services.discount}>{formatVnd(service.discount)}</span>)}
                      <span data-label={jt.services.finalPrice}>{formatVnd(service.finalPrice)}</span>
                      <span className="journey-service-paid" data-label={jt.services.collected}>
                        <strong>{formatVnd(displayedAppliedAmount)}</strong>
                      </span>
                      {canDeleteTreatmentServices && (<div className="journey-service-action-cell" data-label={jt.services.actions}>
                          {service.source === "database" ? (serviceDeleteLocked ? (<button className="icon-button small" type="button" disabled title={jt.services.deleteLocked} aria-label={jt.services.deleteLocked}>
                                <Trash2 size={16}/>
                              </button>) : (<form action={deleteJourneyTreatmentServiceAction} onSubmit={(event) => {
                            if (!window.confirm(jt.services.deleteConfirm)) {
                                event.preventDefault();
                            }
                        }}>
                                <input name="patientId" type="hidden" value={selectedPatientKey}/>
                                <input name="treatmentServiceId" type="hidden" value={service.id}/>
                                <button className="icon-button small danger-icon" type="submit" aria-label={jt.services.delete} title={jt.services.delete}>
                                  <Trash2 size={16}/>
                                </button>
                              </form>)) : service.source === "odontogram" ? (<button className="icon-button small danger-icon" type="button" onClick={() => {
                            if (window.confirm(jt.services.deleteConfirm)) {
                                removeDraftTreatmentService(service.id);
                            }
                        }} aria-label={jt.services.delete} title={jt.services.delete}>
                              <Trash2 size={16}/>
                            </button>) : (<span aria-hidden="true">-</span>)}
                        </div>)}
                      <div className={serviceProgressIsCancelled(service.progress)
                    ? "journey-service-progress cancelled"
                    : "journey-service-progress"} role="progressbar" data-label={jt.services.progress} aria-label={`${displayStatus(service.progress, language)} ${progressPercent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                        <div className="journey-service-progress-meta">
                          <span>{displayStatus(service.progress, language)}</span>
                          <strong>{progressPercent}%</strong>
                        </div>
                        <span className="journey-service-progress-track">
                          <span className="journey-service-progress-fill" style={{ width: `${progressPercent}%` }}/>
                        </span>
                      </div>
                    </div>);
        })) : (<EmptyState label={chartSearchQuery
                ? jt.empty.noMatchingServices
                : jt.empty.noServices}/>)}
            </div>
          </section>);
}
