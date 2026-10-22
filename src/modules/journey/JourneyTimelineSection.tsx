"use client";
import { CalendarDays, CheckCircle2, FileText, MessageSquareText, } from "lucide-react";
import { lockClinicalNoteAction } from "@/app/(app)/clinical/actions";
import { updatePatientFileGovernanceAction } from "@/app/(app)/patient-files/actions";
import { createJourneyCommentAction, } from "@/app/(app)/journey/actions";
import { EmptyState, PanelHeader } from "@/components/suite-primitives";
import { formatJourneyTimelineDateTime, formatJourneyTimelineTime, journeyTimelineTimestamp } from "@/lib/journey-timeline";
import { displayStatus, statusClass, StatusPill, timelineFileKind, journeyTimelineFilters } from "./journey-shared";
import type { PatientJourneyPanelModel } from "./journey-model";
export function JourneyTimelineSection(model: Pick<PatientJourneyPanelModel, "jt" | "filteredSessionEvents" | "sessionEvents" | "timelineFilter" | "setTimelineFilter" | "language" | "unfinishedClinicalNotes" | "canCompleteClinicalNotes" | "timelineDayGroups" | "patientFilesWorkspace" | "renderTimelineAttachment" | "renderTimelineImageButton" | "selectedPatient" | "commentBody" | "setCommentBody" | "journeyRecordsReady" | "setCommentAttachments" | "setCommentImage" | "commentAttachments">) {
    const { jt, filteredSessionEvents, sessionEvents, timelineFilter, setTimelineFilter, language, unfinishedClinicalNotes, canCompleteClinicalNotes, timelineDayGroups, patientFilesWorkspace, renderTimelineAttachment, renderTimelineImageButton, selectedPatient, commentBody, setCommentBody, journeyRecordsReady, setCommentAttachments, setCommentImage, commentAttachments } = model;
    if (!selectedPatient)
        return null;
    return (<section className="panel chart-timeline-panel" id="chart-timeline">
            <PanelHeader icon={CalendarDays} title={jt.timeline.title} action={`${filteredSessionEvents.length}/${sessionEvents.length}`}/>

            <div className="segmented chart-filter-row" role="group" aria-label={jt.timeline.title}>
              {journeyTimelineFilters.map((filter) => (<button className={timelineFilter === filter ? "active" : ""} type="button" key={filter} onClick={() => {
                setTimelineFilter(filter);
            }}>
                  {displayStatus(filter, language)}
                </button>))}
            </div>

            {unfinishedClinicalNotes.length > 0 &&
            (timelineFilter === "All" || timelineFilter === "Clinical") && (<section className="timeline-unfinished" aria-label={jt.timeline.unfinishedNotes}>
                  <header>
                    <div>
                      <strong>{jt.timeline.unfinishedNotes}</strong>
                      <span>{jt.timeline.unfinishedNotesHint}</span>
                    </div>
                    <span className="timeline-unfinished-count">
                      {unfinishedClinicalNotes.length}
                    </span>
                  </header>
                  <div className="timeline-unfinished-list">
                    {unfinishedClinicalNotes.map((note) => (<article key={note.id}>
                        <div>
                          <time>
                            {formatJourneyTimelineDateTime(journeyTimelineTimestamp(note.createdAtIso ?? note.createdAt), note.createdAt, language)}
                          </time>
                          <strong>
                            {note.assessment ??
                    note.prognosis ??
                    note.plan ??
                    note.subjective ??
                    jt.clinical.soapNote}
                          </strong>
                          <small>{note.author}</small>
                        </div>
                        {canCompleteClinicalNotes && (<form action={lockClinicalNoteAction} onSubmit={(submitEvent) => {
                        if (!window.confirm(jt.timeline.completeNoteConfirm)) {
                            submitEvent.preventDefault();
                        }
                    }}>
                            <input name="noteId" type="hidden" value={note.id}/>
                            <button className="secondary-button" type="submit">
                              <CheckCircle2 size={16}/>
                              {jt.timeline.completeNote}
                            </button>
                          </form>)}
                      </article>))}
                  </div>
                </section>)}

            <div className="journey-timeline chart-timeline">
              {timelineDayGroups.length > 0 ? (timelineDayGroups.map((dayGroup) => (<section className="timeline-day-group" key={dayGroup.id}>
                    <header className="timeline-day-header">
                      <time>{dayGroup.label}</time>
                      <span>
                        {dayGroup.events.length} {jt.timeline.eventCount}
                      </span>
                    </header>
                    <div className="timeline-day-events">
                      {dayGroup.events.map((event) => (<details className="chart-timeline-event" key={event.id}>
                          <summary>
                            <time>
                              {formatJourneyTimelineTime(event.sortMs, event.label, language)}
                            </time>
                            <span className={`chart-event-marker ${statusClass(event.group)}`}/>
                            <span className="chart-timeline-event-body">
                              <span>{event.kind}</span>
                              <strong>{event.title}</strong>
                            </span>
                            <StatusPill status={event.status}/>
                          </summary>
                          <div className="timeline-event-detail">
                            {event.detail && <p>{event.detail}</p>}
                            {event.fileUrl &&
                    (!event.attachments ||
                        event.attachments.length === 0) && (<a className="secondary-button timeline-file-link" href={event.fileUrl} rel="noreferrer" target="_blank">
                                  <FileText size={16}/>
                                  {jt.timeline.openFile}
                                </a>)}
                            {event.patientFileGovernance && (<form action={updatePatientFileGovernanceAction} className="patient-file-governance-form">
                                <input name="fileId" type="hidden" value={event.patientFileGovernance.fileId}/>
                                <label>
                                  {jt.timeline.scanStatus}
                                  <select name="virusScanStatus" defaultValue={event.patientFileGovernance.virusScanStatus} disabled={!patientFilesWorkspace?.canMutate}>
                                    {[
                        "NOT_SCANNED",
                        "PENDING",
                        "CLEAN",
                        "QUARANTINED",
                        "INFECTED",
                        "EXTERNAL_URL",
                    ].map((status) => (<option value={status} key={status}>
                                        {displayStatus(status, language)}
                                      </option>))}
                                  </select>
                                </label>
                                <label>
                                  {jt.timeline.retentionUntil}
                                  <input name="retentionUntil" type="date" defaultValue={event.patientFileGovernance
                        .retentionUntilIso ?? ""} disabled={!patientFilesWorkspace?.canMutate}/>
                                </label>
                                <button type="submit" disabled={!patientFilesWorkspace?.canMutate}>
                                  {jt.timeline.saveGovernance}
                                </button>
                              </form>)}
                            {event.attachments &&
                    event.attachments.length > 0 ? (<div className="timeline-attachment-list">
                                {event.attachments.map((attachment) => renderTimelineAttachment(attachment, "preview"))}
                              </div>) : event.imageUrl ? (renderTimelineImageButton(event.imageUrl, event.imageName, event.id)) : null}
                          </div>
                        </details>))}
                    </div>
                  </section>))) : (<EmptyState label={jt.empty.noMatchingEvents}/>)}
            </div>

            <form action={createJourneyCommentAction} className="timeline-comment-form" id="chart-comment">
              <input name="patientId" type="hidden" value={selectedPatient.id}/>
              <label>
                {jt.timeline.comment}
                <textarea name="body" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={jt.timeline.commentPlaceholder} disabled={!journeyRecordsReady}/>
              </label>
              <label>
                {jt.timeline.attachment}
                <input name="file" type="file" accept="image/*,video/mp4,video/quicktime,application/pdf,.pdf,.stl,.ply,.obj,.3mf,.glb,.gltf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={!journeyRecordsReady} multiple onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            const attachments = files.map((file, index) => ({
                id: `${file.name}-${file.size}-${index}`,
                name: file.name,
                url: URL.createObjectURL(file),
                mimeType: file.type || null,
                fileKind: timelineFileKind(file.name, file.type),
                sizeBytes: file.size,
                previewUrl: null,
                thumbnailUrl: null,
            }));
            const firstImage = attachments.find((attachment) => attachment.mimeType?.startsWith("image/"));
            setCommentAttachments(attachments);
            setCommentImage(firstImage
                ? {
                    name: firstImage.name ?? jt.timeline.openImage,
                    url: firstImage.url,
                }
                : null);
        }}/>
              </label>
              {commentAttachments.length > 0 && (<div className="timeline-attachment-list">
                  {commentAttachments.map((attachment) => renderTimelineAttachment(attachment, "preview"))}
                </div>)}
              <button className="primary-button" type="submit" disabled={!journeyRecordsReady}>
                <MessageSquareText size={16}/>
                {jt.timeline.postComment}
              </button>
            </form>
          </section>);
}
