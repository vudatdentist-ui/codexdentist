import type { journeyText } from "./journey-shared";
import { formatVnd, type Appointment, type Invoice, type Patient, type TreatmentPlan } from "@/lib/data";
import { compareJourneyTimelineEvents, formatJourneyTimelineDateTime, journeyTimelineTimestamp } from "@/lib/journey-timeline";
import { displayStatus, JourneyReceipt, receiptMethodLabel, receiptMethodLabelForBilling, serviceProgressLabelFromPercent, JourneyServiceRow, displayServiceInstanceCode, JourneyComment, JourneyTimelineEvent, journeyDate } from "./journey-shared";
export function buildJourneyTimeline(input: {
    selectedAppointments: Appointment[];
    language: import("@/components/AppLanguage").Language;
    selectedNotes: import("@/lib/clinical-types").ClinicalNoteSummary[];
    jt: (typeof journeyText)[import("@/components/AppLanguage").Language];
    selectedPlans: TreatmentPlan[];
    databaseTreatmentServices: JourneyServiceRow[];
    visiblePatientsById: Map<string, Patient>;
    selectedReceipts: JourneyReceipt[];
    treatmentServices: JourneyServiceRow[];
    selectedBillingReceipts: import("@/lib/billing-types").BillingReceiptSummary[];
    selectedInvoices: Invoice[];
    selectedPrescriptions: import("@/lib/pharmacy-types").PrescriptionSummary[];
    selectedPatientForms: import("@/lib/forms-types").PatientFormSummary[];
    selectedPatientFiles: import("@/lib/patient-files-types").PatientFileSummary[];
    selectedCrmActivities: import("@/lib/crm-types").CrmActivitySummary[];
    selectedJourneyComments: import("@/lib/journey-records-types").JourneyCommentSummary[];
    timelineComments: JourneyComment[];
    selectedPatientKey: string;
}): JourneyTimelineEvent[] {
    const { selectedAppointments, language, selectedNotes, jt, selectedPlans, databaseTreatmentServices, visiblePatientsById, selectedReceipts, treatmentServices, selectedBillingReceipts, selectedInvoices, selectedPrescriptions, selectedPatientForms, selectedPatientFiles, selectedCrmActivities, selectedJourneyComments, timelineComments, selectedPatientKey } = input;
    return [
        ...selectedAppointments.map((appointment, index) => ({
            group: "Session" as const,
            id: `appointment-${appointment.id}`,
            kind: displayStatus("Session", language),
            label: appointment.time,
            sortMs: journeyTimelineTimestamp(appointment.startsAt, Number.MAX_SAFE_INTEGER - index),
            status: appointment.status,
            title: appointment.procedure,
            detail: language === "vi"
                ? `${appointment.provider} · ${appointment.room} · ${appointment.duration} phút`
                : `${appointment.provider} · ${appointment.room} · ${appointment.duration} min`,
        })),
        ...selectedNotes.filter((note) => note.lockedAt).map((note) => ({
            group: "Clinical" as const,
            id: `note-${note.id}`,
            kind: jt.clinical.examSection,
            label: note.createdAt,
            sortMs: journeyTimelineTimestamp(note.createdAtIso ?? note.createdAt),
            status: "Completed",
            title: note.assessment ??
                note.prognosis ??
                note.plan ??
                note.subjective ??
                jt.clinical.soapNote,
            detail: [
                note.subjective,
                note.objective,
                note.prognosis
                    ? `${jt.clinical.prognosis}: ${note.prognosis}`
                    : null,
                note.plan,
            ]
                .filter(Boolean)
                .join(" | "),
        })),
        ...selectedPlans.map((plan) => ({
            group: "Treatment" as const,
            id: `plan-${plan.id}`,
            kind: jt.plan.title,
            label: plan.createdAt ?? jt.actions.plan,
            sortMs: journeyTimelineTimestamp(plan.createdAt),
            status: plan.status,
            title: plan.title,
            detail: `${plan.phase} - ${formatVnd(plan.patientShare)}`,
        })),
        ...databaseTreatmentServices.flatMap((service) => (service.progressEvents ?? []).map((event) => {
            const fromProgress = serviceProgressLabelFromPercent(event.fromProgressPercent, undefined, service.progressSteps);
            const toProgress = serviceProgressLabelFromPercent(event.toProgressPercent, undefined, service.progressSteps);
            const progressLabel = `${fromProgress} -> ${toProgress}`;
            const participants = [
                event.consultantName
                    ? `${jt.services.consultant}: ${event.consultantName}`
                    : "",
                `${jt.services.performedBy}: ${event.performedByName}`,
                event.clinicalSupportName
                    ? `${jt.services.clinicalSupport}: ${event.clinicalSupportName}`
                    : "",
                event.assistantPrimaryName
                    ? `${jt.services.assistantPrimary}: ${event.assistantPrimaryName}`
                    : "",
                event.assistantSecondaryName
                    ? `${jt.services.assistantSecondary}: ${event.assistantSecondaryName}`
                    : "",
            ]
                .filter(Boolean)
                .join(" · ");
            return {
                group: "Treatment" as const,
                id: `service-progress-${event.id}`,
                kind: jt.services.recordProgress,
                label: event.occurredAt,
                sortMs: journeyTimelineTimestamp(event.occurredAtIso),
                status: `${Math.round(event.toProgressPercent)}%`,
                title: `${displayServiceInstanceCode(service, visiblePatientsById.get(service.patientId))} · ${service.serviceName}`,
                detail: [progressLabel, participants, event.note].filter(Boolean).join(" · "),
            };
        })),
        ...selectedReceipts.map((receipt) => {
            const receiptService = treatmentServices.find((service) => service.id === receipt.serviceId);
            return {
                group: "Billing" as const,
                id: `receipt-${receipt.id}`,
                kind: jt.timeline.receipt,
                label: "",
                sortMs: journeyTimelineTimestamp(receipt.collectedAt),
                status: "Paid",
                title: receiptService
                    ? `${displayServiceInstanceCode(receiptService, visiblePatientsById.get(receiptService.patientId))} · ${receiptService.serviceName}`
                    : receipt.id,
                detail: `${formatVnd(receipt.amount)} · ${receiptMethodLabel(receipt.method, language)}`,
            };
        }),
        ...selectedBillingReceipts.map((receipt) => ({
            group: "Billing" as const,
            id: `billing-receipt-${receipt.id}`,
            kind: receipt.method === "credit_balance"
                ? language === "vi"
                    ? "Phân bổ tiền dư"
                    : "Credit allocation"
                : jt.timeline.receipt,
            label: receipt.receivedAt,
            sortMs: journeyTimelineTimestamp(receipt.receivedAtIso),
            status: receipt.unallocatedAmount > 0 ? "Credit balance" : "Paid",
            title: receipt.receiptNo,
            detail: receipt.method === "credit_balance"
                ? [
                    formatVnd(receipt.allocatedAmount || receipt.amount),
                    language === "vi" ? "Từ tiền dư/chưa phân bổ" : "From credit balance",
                    language === "vi" ? "Đã phân bổ vào dịch vụ" : "Allocated to service",
                    receipt.reference
                        ? `${language === "vi" ? "Tham chiếu" : "Reference"} ${receipt.reference}`
                        : "",
                ]
                    .filter(Boolean)
                    .join(" · ")
                : [
                    formatVnd(receipt.amount),
                    receiptMethodLabelForBilling(receipt.method, language),
                    receipt.allocatedAmount > 0
                        ? `${language === "vi" ? "Đã phân bổ" : "Allocated"} ${formatVnd(receipt.allocatedAmount)}`
                        : "",
                    receipt.unallocatedAmount > 0
                        ? `${language === "vi" ? "Còn dư/chưa phân bổ" : "Remaining unallocated"} ${formatVnd(receipt.unallocatedAmount)}`
                        : "",
                    receipt.reference
                        ? `${language === "vi" ? "Tham chiếu" : "Reference"} ${receipt.reference}`
                        : "",
                ]
                    .filter(Boolean)
                    .join(" · "),
        })),
        ...selectedInvoices.map((invoice) => ({
            group: "Billing" as const,
            id: `invoice-${invoice.id}`,
            kind: displayStatus("Billing", language),
            label: invoice.due,
            sortMs: journeyTimelineTimestamp(invoice.issuedAtMs ?? invoice.due),
            status: invoice.status,
            title: invoice.id,
            detail: [
                `${formatVnd(invoice.paidAmount ?? 0)} / ${formatVnd(invoice.amount)}`,
                `${language === "vi" ? "Hạn thanh toán" : "Due"} ${journeyDate(invoice.due)}`,
            ].join(" · "),
        })),
        ...selectedPrescriptions.map((prescription) => ({
            group: "Clinical" as const,
            id: `prescription-${prescription.id}`,
            kind: jt.timeline.prescription,
            label: prescription.createdAt,
            sortMs: journeyTimelineTimestamp(prescription.createdAtIso),
            status: prescription.status,
            title: prescription.prescriptionNo,
            detail: prescription.items
                .map((item) => `${item.drugName}: ${item.sig}`)
                .join(" | ") || prescription.diagnosis || jt.timeline.prescription,
        })),
        ...selectedPatientForms.map((form) => ({
            group: "Files" as const,
            id: `form-${form.id}`,
            kind: jt.timeline.patientForm,
            label: form.completedAt ?? form.sentAt ?? form.createdAt,
            sortMs: journeyTimelineTimestamp(form.completedAtIso ?? form.sentAtIso ?? form.createdAtIso),
            status: form.status,
            title: `${form.formNo} · ${form.templateName}`,
            detail: form.responseText ?? form.templateCode,
        })),
        ...selectedPatientFiles.filter((file) => file.category !== "TIMELINE_COMMENT").map((file) => ({
            group: "Files" as const,
            id: `patient-file-${file.id}`,
            kind: file.category,
            label: file.createdAt,
            sortMs: journeyTimelineTimestamp(file.createdAtIso),
            status: "File",
            title: file.title,
            detail: [file.fileName, file.notes].filter(Boolean).join(" · ") || file.url,
            fileUrl: file.url,
            patientFileGovernance: {
                fileId: file.id,
                retentionUntilIso: file.retentionUntilIso,
                virusScanStatus: file.virusScanStatus,
            },
            imageUrl: file.mimeType?.startsWith("image/")
                ? file.previewUrl ?? file.url
                : undefined,
            imageName: file.fileName ?? file.title,
        })),
        ...selectedCrmActivities.map((activity) => ({
            group: "Session" as const,
            id: `crm-activity-${activity.id}`,
            kind: `CSKH · ${displayStatus(activity.type, language)}`,
            label: activity.createdAt,
            sortMs: journeyTimelineTimestamp(activity.createdAtIso),
            status: activity.completedAt ? "Completed" : "Open",
            title: activity.subject,
            detail: [
                activity.channel ? displayStatus(activity.channel, language) : "",
                activity.body,
                activity.dueAt
                    ? `${language === "vi" ? "Hẹn" : "Due"} ${activity.dueAt}`
                    : "",
            ]
                .filter(Boolean)
                .join(" · "),
        })),
        ...selectedJourneyComments.map((comment) => ({
            group: comment.attachments.length > 0 ? ("Files" as const) : ("Clinical" as const),
            id: `journey-comment-${comment.id}`,
            kind: comment.authorName,
            label: comment.createdAt,
            sortMs: journeyTimelineTimestamp(comment.createdAtIso),
            status: "Comment",
            title: comment.body,
            detail: comment.attachments.length > 0
                ? `${jt.timeline.imageDetailPrefix}: ${comment.attachments
                    .map((attachment) => attachment.name)
                    .filter(Boolean)
                    .join(", ")}`
                : jt.timeline.internalComment,
            attachments: comment.attachments,
            imageUrl: comment.attachments.find((attachment) => attachment.mimeType?.startsWith("image/"))?.url,
            fileUrl: comment.attachments[0]?.url,
            imageName: comment.attachments.find((attachment) => attachment.mimeType?.startsWith("image/"))?.name ??
                comment.attachments[0]?.name ??
                undefined,
        })),
        ...timelineComments
            .filter((comment) => comment.patientId === selectedPatientKey)
            .map((comment) => ({
            group: comment.attachments && comment.attachments.length > 0
                ? ("Files" as const)
                : comment.imageUrl
                    ? ("Files" as const)
                    : ("Clinical" as const),
            id: comment.id,
            kind: comment.author,
            label: "",
            sortMs: journeyTimelineTimestamp(comment.createdAt),
            status: "Comment",
            title: comment.body,
            detail: comment.attachments && comment.attachments.length > 0
                ? `${jt.timeline.imageDetailPrefix}: ${comment.attachments
                    .map((attachment) => attachment.name)
                    .filter(Boolean)
                    .join(", ")}`
                : comment.imageName
                    ? `${jt.timeline.imageDetailPrefix}: ${comment.imageName}`
                    : jt.timeline.internalComment,
            attachments: comment.attachments,
            imageUrl: comment.attachments?.find((attachment) => attachment.mimeType?.startsWith("image/"))?.url ?? comment.imageUrl,
            fileUrl: comment.attachments?.[0]?.url,
            imageName: comment.attachments?.find((attachment) => attachment.mimeType?.startsWith("image/"))?.name ??
                comment.attachments?.[0]?.name ??
                comment.imageName,
        })),
    ]
        .map((event) => ({
        ...event,
        label: formatJourneyTimelineDateTime(event.sortMs, event.label, language),
    }))
        .sort(compareJourneyTimelineEvents);
}
