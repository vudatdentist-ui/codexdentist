"use client";
import { Activity, WalletCards } from "lucide-react";
import { createJourneyTreatmentServicesAction, } from "@/app/(app)/journey/actions";
import { PatientOdontogramEditor } from "@/components/PatientOdontogramEditor";
import { PanelHeader } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { archTargets, treatmentTargetLabel, serviceCatalogOptionName, } from "./journey-shared";
import type { PatientJourneyPanelModel } from "./journey-model";
export function OdontogramSection(model: Pick<PatientJourneyPanelModel, "jt" | "selectedPatientKey" | "odontogramReady" | "selectedArchTargets" | "toggleArchTarget" | "language" | "selectedServiceTargets" | "journeyServiceDatabaseReady" | "selectedLibraryService" | "setSelectedTeeth" | "odontogramDiagnosis" | "setOdontogramDiagnosis" | "selectedServiceId" | "setSelectedServiceId" | "serviceOptions" | "addServicesFromOdontogram" | "selectedOdontogram" | "updateSelectedToothTargets" | "selectedTeeth" | "selectedToothTargets">) {
    const { jt, selectedPatientKey, odontogramReady, selectedArchTargets, toggleArchTarget, language, selectedServiceTargets, journeyServiceDatabaseReady, selectedLibraryService, setSelectedTeeth, odontogramDiagnosis, setOdontogramDiagnosis, selectedServiceId, setSelectedServiceId, serviceOptions, addServicesFromOdontogram, selectedOdontogram, updateSelectedToothTargets, selectedToothTargets } = model;
    return (<section className="panel journey-odontogram-panel" id="chart-odontogram">
            <PanelHeader icon={Activity} title={jt.odontogram.title}/>
            <PatientOdontogramEditor key={selectedPatientKey} canEdit={odontogramReady} chartFooter={<div className="odontogram-workbench">
                  <div className="odontogram-target-toolbar">
                    <div className="odontogram-target-actions">
                      <p className="eyebrow">{jt.odontogram.targetPrompt}</p>
                      <div className="arch-target-row" role="group" aria-label={jt.odontogram.targetAria}>
                        {archTargets.map((target) => (<button className={selectedArchTargets.includes(target.id)
                    ? "arch-target active"
                    : "arch-target"} type="button" key={target.id} onClick={() => toggleArchTarget(target.id)} aria-pressed={selectedArchTargets.includes(target.id)}>
                            {treatmentTargetLabel(target.id, language)}
                          </button>))}
                      </div>
                    </div>
                    <div className="selected-teeth-row" aria-live="polite">
                      {selectedServiceTargets.length > 0 ? (selectedServiceTargets.map((target) => (<span key={target}>{target}</span>))) : (<small>{jt.odontogram.emptySelection}</small>)}
                    </div>
                  </div>
                  <form className="odontogram-planner" action={journeyServiceDatabaseReady
                ? createJourneyTreatmentServicesAction
                : undefined} onSubmit={() => {
                if (journeyServiceDatabaseReady &&
                    selectedLibraryService &&
                    selectedServiceTargets.length > 0) {
                    window.setTimeout(() => setSelectedTeeth([]), 0);
                }
            }}>
                    <input name="patientId" type="hidden" value={selectedPatientKey}/>
                    <input name="targets" type="hidden" value={selectedServiceTargets.join("\n")}/>
                    <label>
                      {jt.odontogram.diagnosis}
                      <input name="diagnosis" value={odontogramDiagnosis} onChange={(event) => setOdontogramDiagnosis(event.target.value)}/>
                    </label>
                    <label>
                      {jt.odontogram.serviceLibrary}
                      <select name="serviceCatalogItemId" value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)} disabled={serviceOptions.length === 0}>
                        <option value="" disabled>
                          {jt.odontogram.selectService}
                        </option>
                        {serviceOptions.map((service) => (<option value={service.id} key={service.id}>
                            {service.code} · {serviceCatalogOptionName(service, language)} - {formatVnd(service.price)}
                          </option>))}
                      </select>
                    </label>
                    <button className="primary-button" type={journeyServiceDatabaseReady ? "submit" : "button"} onClick={journeyServiceDatabaseReady
                ? undefined
                : addServicesFromOdontogram} disabled={!selectedLibraryService ||
                selectedServiceTargets.length === 0}>
                      <WalletCards size={16}/>
                      {jt.odontogram.addService}
                    </button>
                  </form>
                </div>} initialOdontogram={selectedOdontogram} language={language} onSelectionChange={(teeth) => updateSelectedToothTargets(teeth.map((tooth) => `R${tooth}`))} patientId={selectedPatientKey} selectedTeeth={selectedToothTargets.map((tooth) => tooth.replace(/^R/, ""))}/>
          </section>);
}
