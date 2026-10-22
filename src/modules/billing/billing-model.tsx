"use client";
import { getBillingAdvancedLabels } from "./billing-copy";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAppLanguage } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { cappedPaidAmount, invoiceBalanceAmount, serviceAppliedAmount as calculateServiceAppliedAmount, serviceRemainingInvoiceCapacity as calculateServiceRemainingInvoiceCapacity, serviceUninvoicedAmount as calculateServiceUninvoicedAmount } from "@/lib/billing-calculations";
import { type Appointment, type Clinic, type Invoice, type Patient } from "@/lib/data";
import type { BillingWorkspace } from "@/lib/billing-types";
import { JourneyReceiptDraftStore, BillingJourneyServiceFilter, BillingPeriodFilter, BillingSection, BillingInvoiceFilter, billingJourneyServiceFilters, useNoticeText, vietnamDateKey, vietnamBillingPeriodRange, isDateKeyInRange, appointmentDateKey, appointmentIsCheckedIn, isCollectableInvoice, isJourneyCollectionMethod, JourneyReceipt, JourneyCreditAllocation, journeyInvoiceIdForService, receiptMethodLabel, collectionMethodLabel, patientCodeFor, patientClassCodeFor, serviceProgressPercent, serviceProgressIsCancelled, serviceProgressLabelFromPercent, JourneyServiceRow, displayServiceInstanceCode, billingText, normalizeSearchText, matchesChartSearch } from "./billing-shared";
export function useBillingPanelModel({ billingSearch, billingWorkspace, journeyInvoiceIds, journeyReceipts, visibleClinicIds, visibleAppointments, visibleClinics, visibleInvoices, visiblePatients, }: {
    actorName: string;
    billingSearch: string;
    billingWorkspace?: BillingWorkspace | null;
    journeyInvoiceIds: Set<string>;
    journeyReceipts: JourneyReceipt[];
    visibleClinicIds: Set<string>;
    visibleAppointments: Appointment[];
    visibleClinics: Clinic[];
    visibleInvoices: Invoice[];
    visiblePatients: Patient[];
}) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { language } = useAppLanguage();
    const bt = billingText[language];
    const requestedBillingPatientId = searchParams.get("patientId") ?? "";
    const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
    const canMutate = billingWorkspace?.canMutate ?? false;
    const [receiptDrafts, setReceiptDrafts] = useState<JourneyReceiptDraftStore>({});
    const journeyCreditAllocations: JourneyCreditAllocation[] = [];
    const [journeyServiceFilter, setJourneyServiceFilter] = useState<BillingJourneyServiceFilter>("all");
    const [billingClinicFilter, setBillingClinicFilter] = useState("all");
    const [billingPeriodFilter, setBillingPeriodFilter] = useState<BillingPeriodFilter>("all");
    const [billingInvoiceFilter, setBillingInvoiceFilter] = useState<BillingInvoiceFilter>("all");
    const [billingSection, setBillingSection] = useState<BillingSection>("collection");
    const [selectedBillingPatientId, setSelectedBillingPatientId] = useState(requestedBillingPatientId);
    const selectBillingPatient = (patientId: string) => {
        const nextParams = new URLSearchParams(searchParams.toString());
        if (patientId) {
            nextParams.set("patientId", patientId);
        }
        else {
            nextParams.delete("patientId");
        }
        setSelectedBillingPatientId(patientId);
        router.replace(`/billing${nextParams.size ? `?${nextParams.toString()}` : ""}`, {
            scroll: false,
        });
    };
    useEffect(() => {
        setSelectedBillingPatientId(requestedBillingPatientId);
    }, [requestedBillingPatientId]);
    const billingClinicOptions = visibleClinics.filter((clinic) => visibleClinicIds.has(clinic.id));
    const activeBillingClinicIds = useMemo(() => billingClinicFilter === "all" || !visibleClinicIds.has(billingClinicFilter)
        ? new Set(visibleClinicIds)
        : new Set([billingClinicFilter]), [billingClinicFilter, visibleClinicIds]);
    const billingPeriodRange = billingPeriodFilter === "all"
        ? null
        : vietnamBillingPeriodRange(billingPeriodFilter);
    const activeBillingAppointments = visibleAppointments.filter((appointment) => activeBillingClinicIds.has(appointment.clinicId));
    const periodAppointments = billingPeriodRange
        ? activeBillingAppointments.filter((appointment) => isDateKeyInRange(appointmentDateKey(appointment), billingPeriodRange))
        : activeBillingAppointments;
    const checkedInTodayPatientIds = new Set(activeBillingAppointments
        .filter((appointment) => appointmentIsCheckedIn(appointment) &&
        isDateKeyInRange(appointmentDateKey(appointment), vietnamBillingPeriodRange("today")))
        .map((appointment) => appointment.patientId));
    const periodAppointmentPatientIds = new Set(periodAppointments
        .filter((appointment) => billingPeriodFilter === "today"
        ? appointmentIsCheckedIn(appointment)
        : appointment.status !== "Cancelled" && appointment.status !== "No-show")
        .map((appointment) => appointment.patientId));
    const billingPeriodPatientIds = billingPeriodFilter === "today"
        ? checkedInTodayPatientIds
        : periodAppointmentPatientIds;
    const patientMatchesBillingClinic = (patient: Patient) => activeBillingClinicIds.has(patient.clinicId);
    const patientMatchesBillingPeriod = (patientId: string) => billingPeriodFilter === "all" || billingPeriodPatientIds.has(patientId);
    const scopedBillingPatients = visiblePatients.filter((patient) => patientMatchesBillingClinic(patient) && patientMatchesBillingPeriod(patient.id));
    const effectiveBillingPatientId = scopedBillingPatients.some((patient) => patient.id === selectedBillingPatientId)
        ? selectedBillingPatientId
        : "";
    const selectedBillingPatient = scopedBillingPatients.find((patient) => patient.id === effectiveBillingPatientId) ??
        null;
    const visiblePatientIdsForForm = new Set(scopedBillingPatients.map((patient) => patient.id));
    const formPatients = billingWorkspace?.patients.filter((patient) => activeBillingClinicIds.has(patient.clinicId) &&
        visiblePatientIdsForForm.has(patient.id)) ??
        [];
    const formReady = Boolean(canMutate && formPatients.length);
    const dueDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    const visiblePatientIds = useMemo(() => new Set(visiblePatients
        .filter((patient) => activeBillingClinicIds.has(patient.clinicId))
        .filter((patient) => !effectiveBillingPatientId || patient.id === effectiveBillingPatientId)
        .map((patient) => patient.id)), [activeBillingClinicIds, effectiveBillingPatientId, visiblePatients]);
    const visiblePatientsById = useMemo(() => new Map(visiblePatients.map((patient) => [patient.id, patient])), [visiblePatients]);
    const databaseServiceBillingById = useMemo(() => new Map((billingWorkspace?.treatmentServices ?? []).map((service) => [
        service.id,
        {
            collectedAmount: service.collectedAmount,
            creditAllocatedAmount: service.creditAllocatedAmount,
            invoicedAmount: service.invoicedAmount,
        },
    ])), [billingWorkspace?.treatmentServices]);
    const databaseJourneyServices: JourneyServiceRow[] = billingWorkspace?.treatmentServices
        .filter((service) => visiblePatientIds.has(service.patientId) &&
        activeBillingClinicIds.has(service.clinicId))
        .map((service) => ({
        id: service.id,
        patientId: service.patientId,
        patientName: service.patientName,
        clinicId: service.clinicId,
        serviceCode: service.serviceCode,
        catalogCode: service.catalogCode,
        createdAt: Date.parse(service.createdAt) || undefined,
        object: service.teeth.join(", ") || service.targetSummary || "",
        diagnosis: service.targetSummary ?? "",
        serviceName: service.serviceName,
        progress: serviceProgressLabelFromPercent(service.currentProgressPercent, service.status),
        listPrice: service.finalPrice,
        discount: 0,
        finalPrice: service.finalPrice,
        collectedAmount: service.collectedAmount,
        creditAllocatedAmount: service.creditAllocatedAmount,
        invoicedAmount: service.invoicedAmount,
        invoiceIds: service.invoiceNos,
        invoiceNos: service.invoiceNos,
        source: "database" as const,
    })) ?? [];
    const journeyServices = databaseJourneyServices;
    const billingVisibleInvoices = visibleInvoices.filter((invoice) => activeBillingClinicIds.has(invoice.clinicId));
    const serviceMatchesBillingPeriod = (service: JourneyServiceRow) => {
        if (billingPeriodFilter === "all") {
            return true;
        }
        if (billingPeriodFilter === "today") {
            return checkedInTodayPatientIds.has(service.patientId);
        }
        const createdAtKey = service.createdAt ? vietnamDateKey(service.createdAt) : "";
        return (billingPeriodPatientIds.has(service.patientId) ||
            Boolean(billingPeriodRange && isDateKeyInRange(createdAtKey, billingPeriodRange)));
    };
    const invoiceMatchesBillingPeriod = (invoice: Invoice) => {
        if (billingPeriodFilter === "all") {
            return true;
        }
        if (billingPeriodFilter === "today") {
            return Boolean(invoice.patientId && checkedInTodayPatientIds.has(invoice.patientId));
        }
        const issuedAtKey = typeof invoice.issuedAtMs === "number" ? vietnamDateKey(invoice.issuedAtMs) : "";
        const dueDateKey = vietnamDateKey(invoice.due);
        return (Boolean(invoice.patientId && billingPeriodPatientIds.has(invoice.patientId)) ||
            Boolean(billingPeriodRange && isDateKeyInRange(issuedAtKey, billingPeriodRange)) ||
            Boolean(billingPeriodRange && isDateKeyInRange(dueDateKey, billingPeriodRange)));
    };
    const receiptMatchesBillingPeriod = (receipt: {
        collectedAt?: number;
        patientId: string;
        receivedAt?: string;
    }) => {
        if (billingPeriodFilter === "all") {
            return true;
        }
        if (billingPeriodFilter === "today") {
            return checkedInTodayPatientIds.has(receipt.patientId);
        }
        const collectedAtKey = typeof receipt.collectedAt === "number" ? vietnamDateKey(receipt.collectedAt) : "";
        const receivedAtKey = receipt.receivedAt ? vietnamDateKey(receipt.receivedAt) : "";
        return (billingPeriodPatientIds.has(receipt.patientId) ||
            Boolean(billingPeriodRange && isDateKeyInRange(collectedAtKey, billingPeriodRange)) ||
            Boolean(billingPeriodRange && isDateKeyInRange(receivedAtKey, billingPeriodRange)));
    };
    const periodJourneyServices = journeyServices.filter(serviceMatchesBillingPeriod);
    const periodInvoices = billingVisibleInvoices.filter(invoiceMatchesBillingPeriod);
    const visibleJourneyReceipts = journeyReceipts.filter((receipt) => visiblePatientIds.has(receipt.patientId) &&
        activeBillingClinicIds.has(receipt.clinicId) &&
        receiptMatchesBillingPeriod(receipt));
    const visibleDatabaseReceipts = billingWorkspace?.receipts.filter((receipt) => visiblePatientIds.has(receipt.patientId) &&
        activeBillingClinicIds.has(receipt.clinicId) &&
        receiptMatchesBillingPeriod(receipt)) ?? [];
    const visibleCreditBalances = billingWorkspace?.creditBalances.filter((balance) => visiblePatientIds.has(balance.patientId) &&
        activeBillingClinicIds.has(balance.clinicId) &&
        patientMatchesBillingPeriod(balance.patientId)) ?? [];
    const serviceCollectedAmount = (serviceId: string) => databaseServiceBillingById.get(serviceId)?.collectedAmount ??
        journeyReceipts
            .filter((receipt) => receipt.serviceId === serviceId)
            .reduce((total, receipt) => total + receipt.amount, 0);
    const serviceCreditAllocationAmount = (serviceId: string) => databaseServiceBillingById.get(serviceId)?.creditAllocatedAmount ??
        journeyCreditAllocations
            .filter((allocation) => allocation.toServiceId === serviceId)
            .reduce((total, allocation) => total + allocation.amount, 0);
    const serviceAppliedAmount = (serviceId: string) => calculateServiceAppliedAmount(serviceCollectedAmount(serviceId), serviceCreditAllocationAmount(serviceId));
    const serviceIsStarted = (service: JourneyServiceRow) => !serviceProgressIsCancelled(service.progress) &&
        serviceProgressPercent(service.progress) > 0;
    const journeyServicesById = new Map(journeyServices.map((service) => [service.id, service]));
    const journeyServicesByInvoiceId = new Map<string, JourneyServiceRow>();
    const journeyInvoicesByServiceId = new Map<string, Invoice[]>();
    billingVisibleInvoices.forEach((invoice) => {
        const explicitService = invoice.serviceId
            ? journeyServicesById.get(invoice.serviceId)
            : undefined;
        if (!journeyInvoiceIds.has(invoice.id) && !explicitService) {
            return;
        }
        const legacyService = explicitService ??
            journeyServices.find((service) => service.invoiceId === invoice.id ||
                service.invoiceIds?.includes(invoice.id) ||
                (!invoice.serviceId && invoice.id === journeyInvoiceIdForService(service.id)));
        if (!legacyService) {
            return;
        }
        journeyServicesByInvoiceId.set(invoice.id, legacyService);
        journeyInvoicesByServiceId.set(legacyService.id, [
            ...(journeyInvoicesByServiceId.get(legacyService.id) ?? []),
            invoice,
        ]);
    });
    const activeServiceInvoices = (serviceId: string) => (journeyInvoicesByServiceId.get(serviceId) ?? []).filter((invoice) => invoice.status !== "Void");
    const serviceInvoicedAmount = (serviceId: string) => databaseServiceBillingById.get(serviceId)?.invoicedAmount ??
        activeServiceInvoices(serviceId).reduce((total, invoice) => total + invoice.amount, 0);
    const serviceRemainingInvoiceCapacity = (service: JourneyServiceRow) => calculateServiceRemainingInvoiceCapacity(service.finalPrice, serviceInvoicedAmount(service.id));
    const serviceUninvoicedAmount = (service: JourneyServiceRow) => calculateServiceUninvoicedAmount(service.finalPrice, serviceAppliedAmount(service.id), serviceInvoicedAmount(service.id));
    const billingSearchQuery = normalizeSearchText(billingSearch.trim());
    const updateReceiptDraft = (serviceId: string, patch: Partial<JourneyReceiptDraftStore[string]>) => {
        setReceiptDrafts((current) => ({
            ...current,
            [serviceId]: {
                amount: current[serviceId]?.amount ?? "",
                method: current[serviceId]?.method ?? "cash",
                ...patch,
            },
        }));
    };
    const sortedJourneyServices = periodJourneyServices;
    const billingInvoiceAmount = (invoice: Invoice) => invoice.amount;
    const billingInvoicePaidAmount = (invoice: Invoice) => {
        if (!journeyInvoiceIds.has(invoice.id)) {
            return invoice.paidAmount ?? 0;
        }
        const amount = billingInvoiceAmount(invoice);
        const paidAmount = invoice.paidAmount ?? (invoice.status === "Paid" ? amount : 0);
        return cappedPaidAmount(paidAmount, amount);
    };
    const billingInvoiceBalance = (invoice: Invoice) => invoiceBalanceAmount(billingInvoiceAmount(invoice), billingInvoicePaidAmount(invoice));
    const journeyInvoiceSequenceTime = (invoice: Invoice) => {
        if (typeof invoice.issuedAtMs === "number" && Number.isFinite(invoice.issuedAtMs)) {
            return invoice.issuedAtMs;
        }
        const dueTime = Date.parse(invoice.due);
        return Number.isFinite(dueTime) ? dueTime : Number.MAX_SAFE_INTEGER;
    };
    const sortJourneyInvoicesBySequence = (invoices: Invoice[]) => [...invoices].sort((left, right) => {
        const timeDelta = journeyInvoiceSequenceTime(left) - journeyInvoiceSequenceTime(right);
        if (timeDelta !== 0) {
            return timeDelta;
        }
        return left.id.localeCompare(right.id);
    });
    const journeyServiceInvoiceSnapshot = (service: JourneyServiceRow, invoice: Invoice) => {
        const orderedInvoices = sortJourneyInvoicesBySequence(activeServiceInvoices(service.id));
        const invoiceIndex = orderedInvoices.findIndex((item) => item.id === invoice.id);
        const invoicesThroughCurrent = invoiceIndex >= 0 ? orderedInvoices.slice(0, invoiceIndex + 1) : [invoice];
        const paidThroughInvoice = Math.min(invoicesThroughCurrent.reduce((total, item) => total + billingInvoicePaidAmount(item), 0), service.finalPrice);
        return {
            balanceAfterInvoice: Math.max(service.finalPrice - paidThroughInvoice, 0),
            isLatestInvoice: orderedInvoices[orderedInvoices.length - 1]?.id === invoice.id,
            paidThroughInvoice,
        };
    };
    const billingJourneyFilterLabel = (filter: BillingJourneyServiceFilter) => {
        const labels: Record<BillingJourneyServiceFilter, string> = {
            all: bt.filterAll,
            cancelled: bt.filterCancelled,
            complete: bt.filterComplete,
            deposit: bt.filterDeposit,
            has_invoice: bt.filterHasInvoice,
            invoice_requested: bt.filterInvoiceRequested,
            needs_collection: bt.filterNeedsCollection,
            no_invoice: bt.filterNoInvoice,
            partial_invoice: bt.filterPartialInvoice,
        };
        return labels[filter];
    };
    const billingInvoiceFilterLabel = (filter: BillingInvoiceFilter) => {
        const labels: Record<BillingInvoiceFilter, string> = language === "vi"
            ? {
                all: "Tất cả hóa đơn",
                service_linked: "Hóa đơn dịch vụ",
                standalone: "Hóa đơn độc lập",
                open_balance: "Còn công nợ",
                overdue: "Quá hạn",
                paid: "Đã thanh toán",
                partial: "Thanh toán một phần",
                void: "Đã hủy",
            }
            : {
                all: "All invoices",
                service_linked: "Service invoices",
                standalone: "Standalone invoices",
                open_balance: "Open balance",
                overdue: "Overdue",
                paid: "Paid",
                partial: "Partial",
                void: "Void",
            };
        return labels[filter];
    };
    const invoiceIsServiceLinked = (invoice: Invoice) => Boolean(invoice.serviceId || journeyInvoiceIds.has(invoice.id));
    const invoiceMatchesFilter = (invoice: Invoice, filter: BillingInvoiceFilter) => {
        switch (filter) {
            case "service_linked":
                return invoiceIsServiceLinked(invoice);
            case "standalone":
                return !invoiceIsServiceLinked(invoice);
            case "open_balance":
                return isCollectableInvoice(invoice) && billingInvoiceBalance(invoice) > 0;
            case "overdue":
                return invoice.status === "Overdue";
            case "paid":
                return invoice.status === "Paid";
            case "partial":
                return invoice.status === "Partial";
            case "void":
                return invoice.status === "Void";
            default:
                return true;
        }
    };
    const serviceMatchesJourneyFilter = (service: JourneyServiceRow, filter: BillingJourneyServiceFilter) => {
        if (filter === "all") {
            return true;
        }
        const appliedAmount = serviceAppliedAmount(service.id);
        const remainingAmount = Math.max(service.finalPrice - appliedAmount, 0);
        const isCancelled = serviceProgressIsCancelled(service.progress);
        const isStarted = serviceIsStarted(service);
        const invoicedAmount = serviceInvoicedAmount(service.id);
        const hasInvoice = invoicedAmount > 0;
        switch (filter) {
            case "needs_collection":
                return isStarted && remainingAmount > 0;
            case "has_invoice":
                return hasInvoice;
            case "partial_invoice":
                return hasInvoice && invoicedAmount < service.finalPrice;
            case "deposit":
                return !isStarted && !isCancelled && appliedAmount > 0;
            case "invoice_requested":
                return serviceUninvoicedAmount(service) > 0;
            case "no_invoice":
                return !hasInvoice;
            case "complete":
                return isStarted && !isCancelled && remainingAmount <= 0;
            case "cancelled":
                return isCancelled;
            default:
                return true;
        }
    };
    const searchedJourneyServices = sortedJourneyServices.filter((service) => {
        const patient = visiblePatientsById.get(service.patientId);
        const serviceInvoices = activeServiceInvoices(service.id);
        return matchesChartSearch(billingSearchQuery, [
            service.serviceName,
            service.serviceCode,
            service.catalogCode,
            displayServiceInstanceCode(service, patient),
            service.object,
            service.diagnosis,
            service.progress,
            service.invoiceId,
            service.invoiceIds?.join(" "),
            serviceInvoices.map((invoice) => invoice.id).join(" "),
            serviceInvoices.map((invoice) => invoice.status).join(" "),
            serviceInvoices.reduce((total, invoice) => total + invoice.amount, 0),
            patient?.name,
            patient?.phone,
            patient ? patientCodeFor(patient) : undefined,
            patient ? patientClassCodeFor(patient) : undefined,
            service.finalPrice,
            serviceAppliedAmount(service.id),
        ]);
    });
    const journeyFilterOptions = billingJourneyServiceFilters.map((filter) => ({
        filter,
        label: billingJourneyFilterLabel(filter),
        count: searchedJourneyServices.filter((service) => serviceMatchesJourneyFilter(service, filter)).length,
    }));
    const filteredJourneyServices = searchedJourneyServices.filter((service) => serviceMatchesJourneyFilter(service, journeyServiceFilter));
    const filteredJourneyServiceInvoiceIds = new Set(filteredJourneyServices
        .flatMap((service) => (journeyInvoicesByServiceId.get(service.id) ?? []).map((invoice) => invoice.id))
        .filter(Boolean));
    const journeyServiceFilterActive = journeyServiceFilter !== "all";
    const invoiceMatchesVisibleScope = (invoice: Invoice) => {
        const invoicePatient = invoice.patientId
            ? visiblePatientsById.get(invoice.patientId)
            : undefined;
        const relatedService = (invoice.serviceId ? journeyServicesById.get(invoice.serviceId) : undefined) ??
            (journeyInvoiceIds.has(invoice.id)
                ? journeyServicesByInvoiceId.get(invoice.id)
                : undefined);
        const invoiceMatchesSearch = matchesChartSearch(billingSearchQuery, [
            invoice.id,
            invoice.patient,
            invoice.patientId,
            invoicePatient ? patientCodeFor(invoicePatient) : undefined,
            invoice.clinicId,
            invoice.status,
            invoice.due,
            billingInvoiceAmount(invoice),
            billingInvoicePaidAmount(invoice),
            billingInvoiceBalance(invoice),
            journeyInvoiceIds.has(invoice.id) ? bt.localInvoice : "",
            relatedService?.serviceName,
            relatedService?.serviceCode,
            relatedService?.catalogCode,
            relatedService?.object,
            relatedService?.diagnosis,
            relatedService
                ? displayServiceInstanceCode(relatedService, visiblePatientsById.get(relatedService.patientId))
                : undefined,
        ]);
        const invoiceBelongsToFilteredService = filteredJourneyServiceInvoiceIds.has(invoice.id);
        if (journeyServiceFilterActive) {
            return invoiceBelongsToFilteredService;
        }
        return (invoiceMatchesSearch ||
            (billingSearchQuery.length > 0 && invoiceBelongsToFilteredService));
    };
    const invoiceFilterOptions: Array<{
        filter: BillingInvoiceFilter;
        label: string;
        count: number;
    }> = ([
        "all",
        "service_linked",
        "standalone",
        "open_balance",
        "overdue",
        "partial",
        "paid",
        "void",
    ] as BillingInvoiceFilter[]).map((filter) => ({
        filter,
        label: billingInvoiceFilterLabel(filter),
        count: periodInvoices.filter((invoice) => invoiceMatchesVisibleScope(invoice) && invoiceMatchesFilter(invoice, filter)).length,
    }));
    const invoiceFilterActive = billingInvoiceFilter !== "all";
    const filteredInvoices = periodInvoices.filter((invoice) => invoiceMatchesVisibleScope(invoice) &&
        invoiceMatchesFilter(invoice, billingInvoiceFilter));
    const metricJourneyServices = billingSearchQuery || journeyServiceFilterActive
        ? filteredJourneyServices
        : periodJourneyServices;
    const metricInvoices = billingSearchQuery || journeyServiceFilterActive || invoiceFilterActive
        ? filteredInvoices
        : periodInvoices;
    const metricJourneyServiceIds = new Set(metricJourneyServices.map((service) => service.id));
    const metricReceipts = billingSearchQuery
        ? visibleJourneyReceipts.filter((receipt) => {
            const service = journeyServicesById.get(receipt.serviceId);
            const patient = visiblePatientsById.get(receipt.patientId);
            return (metricJourneyServiceIds.has(receipt.serviceId) ||
                matchesChartSearch(billingSearchQuery, [
                    receipt.patient,
                    patient?.name,
                    patient?.phone,
                    patient ? patientCodeFor(patient) : undefined,
                    patient?.email,
                    receipt.amount,
                    receiptMethodLabel(receipt.method, language),
                    service?.serviceName,
                    service?.serviceCode,
                    service?.catalogCode,
                    service && patient ? displayServiceInstanceCode(service, patient) : undefined,
                    service?.object,
                    service?.diagnosis,
                    service?.progress,
                ]));
        })
        : visibleJourneyReceipts;
    const metricDatabaseReceipts = billingSearchQuery
        ? visibleDatabaseReceipts.filter((receipt) => {
            const patient = visiblePatientsById.get(receipt.patientId);
            return matchesChartSearch(billingSearchQuery, [
                receipt.receiptNo,
                receipt.patientName,
                patient?.name,
                patient?.phone,
                patient ? patientCodeFor(patient) : undefined,
                receipt.amount,
                receipt.allocatedAmount,
                receipt.unallocatedAmount,
                isJourneyCollectionMethod(receipt.method)
                    ? collectionMethodLabel(receipt.method, language)
                    : receipt.method,
                receipt.method,
                receipt.reference,
            ]);
        })
        : visibleDatabaseReceipts;
    const openBalanceInvoices = metricInvoices.filter((invoice) => isCollectableInvoice(invoice) && billingInvoiceBalance(invoice) > 0);
    const openTotal = openBalanceInvoices.reduce((total, invoice) => total + billingInvoiceBalance(invoice), 0);
    const allocatedTotal = metricJourneyServices.reduce((total, service) => total + Math.min(serviceAppliedAmount(service.id), service.finalPrice), 0);
    const serviceLinkedMetricInvoices = metricInvoices.filter(invoiceIsServiceLinked);
    const issuedInvoiceTotal = serviceLinkedMetricInvoices
        .filter((invoice) => invoice.status !== "Void")
        .reduce((total, invoice) => total + billingInvoiceAmount(invoice), 0);
    const overdueInvoices = metricInvoices.filter((invoice) => invoice.status === "Overdue");
    const overdueInvoiceTotal = overdueInvoices.reduce((total, invoice) => total + billingInvoiceBalance(invoice), 0);
    const plannedDepositServices = metricJourneyServices.filter((service) => !serviceIsStarted(service) &&
        !serviceProgressIsCancelled(service.progress) &&
        serviceAppliedAmount(service.id) > 0);
    const plannedDepositTotal = plannedDepositServices.reduce((total, service) => total + serviceAppliedAmount(service.id), 0);
    const receiptTotal = billingWorkspace?.source === "database"
        ? metricDatabaseReceipts
            .filter((receipt) => receipt.method !== "credit_balance")
            .reduce((total, receipt) => total + receipt.amount, 0)
        : metricReceipts.reduce((total, receipt) => total + receipt.amount, 0);
    const creditBalanceTotal = visibleCreditBalances.reduce((total, balance) => total + balance.amount, 0);
    const unappliedReceiptTotal = billingWorkspace?.source === "database"
        ? Math.max(creditBalanceTotal, receiptTotal - allocatedTotal, 0)
        : Math.max(receiptTotal - allocatedTotal, 0);
    const directDatabaseReceipts = metricDatabaseReceipts.filter((receipt) => receipt.method !== "credit_balance");
    const creditBalanceAllocationReceipts = metricDatabaseReceipts.filter((receipt) => receipt.method === "credit_balance");
    const recentDatabaseReceipts = directDatabaseReceipts.slice(0, 8);
    const activeCreditBalances = visibleCreditBalances.filter((balance) => balance.amount > 0);
    const selectedBillingPatientBalanceAmount = selectedBillingPatient
        ? visibleCreditBalances.find((balance) => balance.patientId === selectedBillingPatient.id)?.amount ?? 0
        : 0;
    const selectedBillingPatientDirectReceiptTotal = selectedBillingPatient
        ? directDatabaseReceipts
            .filter((receipt) => receipt.patientId === selectedBillingPatient.id)
            .reduce((total, receipt) => total + receipt.amount, 0)
        : 0;
    const patientBillingRows = scopedBillingPatients
        .map((patient) => {
        const services = metricJourneyServices.filter((service) => service.patientId === patient.id);
        const invoices = metricInvoices.filter((invoice) => invoice.patientId === patient.id);
        const receipts = billingWorkspace?.source === "database"
            ? directDatabaseReceipts.filter((receipt) => receipt.patientId === patient.id)
            : metricReceipts.filter((receipt) => receipt.patientId === patient.id);
        const creditBalance = visibleCreditBalances.find((balance) => balance.patientId === patient.id)?.amount ??
            0;
        const progressedServices = services.filter((service) => serviceProgressPercent(service.progress) > 0 &&
            !serviceProgressIsCancelled(service.progress));
        const minimumDueAmount = progressedServices.reduce((total, service) => total + service.finalPrice, 0);
        const paidAmount = services.reduce((total, service) => total + Math.min(serviceAppliedAmount(service.id), service.finalPrice), 0);
        const dueAmount = Math.max(minimumDueAmount - paidAmount, 0);
        const directReceiptAmount = receipts.reduce((total, receipt) => total + receipt.amount, 0);
        const hasBillingActivity = services.length > 0 ||
            invoices.length > 0 ||
            receipts.length > 0 ||
            creditBalance > 0;
        return {
            creditBalance,
            directReceiptAmount,
            dueAmount,
            hasBillingActivity,
            invoices,
            minimumDueAmount,
            paidAmount,
            patient,
            progressedServices,
            receipts,
            services,
        };
    })
        .filter((row) => row.hasBillingActivity)
        .sort((left, right) => {
        const dueDelta = right.dueAmount - left.dueAmount;
        if (dueDelta !== 0) {
            return dueDelta;
        }
        return left.patient.name.localeCompare(right.patient.name, "vi");
    });
    const databaseVisibleInvoices = periodInvoices.filter((invoice) => !invoiceIsServiceLinked(invoice));
    const adjustableInvoices = databaseVisibleInvoices.filter((invoice) => invoice.status !== "Void");
    const refundableInvoices = databaseVisibleInvoices.filter((invoice) => (invoice.paidAmount ?? 0) > 0 && invoice.status !== "Void");
    const visibleStatementLines = billingWorkspace?.statementLines.filter((line) => visiblePatientIds.has(line.patientId) &&
        activeBillingClinicIds.has(line.clinicId) &&
        (billingPeriodFilter === "all" ||
            patientMatchesBillingPeriod(line.patientId) ||
            Boolean(billingPeriodRange &&
                isDateKeyInRange(vietnamDateKey(line.date), billingPeriodRange)))) ?? [];
    const visiblePaymentPlanReminders = billingWorkspace?.paymentPlanReminders.filter((reminder) => !reminder.clinicId || activeBillingClinicIds.has(reminder.clinicId)) ?? [];
    const visiblePaymentPlans = billingWorkspace?.paymentPlans.filter((plan) => visiblePatientIds.has(plan.patientId) &&
        activeBillingClinicIds.has(plan.clinicId) &&
        (billingPeriodFilter === "all" ||
            patientMatchesBillingPeriod(plan.patientId) ||
            Boolean(billingPeriodRange &&
                isDateKeyInRange(vietnamDateKey(plan.createdAt), billingPeriodRange)))) ?? [];
    const billingAdvancedLabels = getBillingAdvancedLabels({ language });
    const remainingJourneyTotal = metricJourneyServices.reduce((total, service) => !serviceIsStarted(service)
        ? total
        : total + Math.max(service.finalPrice - serviceAppliedAmount(service.id), 0), 0);
    const billingResultScopeActive = Boolean(billingSearchQuery) ||
        journeyServiceFilterActive ||
        invoiceFilterActive ||
        billingClinicFilter !== "all" ||
        billingPeriodFilter !== "all";
    const billingSearchSummary = billingResultScopeActive
        ? language === "vi"
            ? `${filteredJourneyServices.length}/${periodJourneyServices.length} dịch vụ, ${filteredInvoices.length}/${periodInvoices.length} hóa đơn`
            : `${filteredJourneyServices.length}/${periodJourneyServices.length} services, ${filteredInvoices.length}/${periodInvoices.length} invoices`
        : bt.searchSummary;
    const billingSectionOptions: Array<{
        key: BillingSection;
        label: string;
        count: string | number;
    }> = [
        {
            key: "collection",
            label: bt.tabCollection,
            count: filteredJourneyServices.length,
        },
        {
            key: "invoices",
            label: bt.tabInvoices,
            count: filteredInvoices.length,
        },
        {
            key: "receipts",
            label: bt.tabReceipts,
            count: recentDatabaseReceipts.length,
        },
        {
            key: "balances",
            label: bt.tabBalances,
            count: activeCreditBalances.length +
                visiblePaymentPlans.length +
                creditBalanceAllocationReceipts.length,
        },
        {
            key: "control",
            label: bt.tabControl,
            count: adjustableInvoices.length + refundableInvoices.length,
        },
    ];
    const billingPeriodOptions: Array<{
        label: string;
        value: BillingPeriodFilter;
    }> = language === "vi"
        ? [
            { label: "Tất cả", value: "all" },
            { label: "Hôm nay - đã check-in", value: "today" },
            { label: "Tuần này", value: "week" },
            { label: "Tuần trước", value: "last_week" },
            { label: "Tháng này", value: "month" },
            { label: "Tháng trước", value: "last_month" },
        ]
        : [
            { label: "All", value: "all" },
            { label: "Today - checked in", value: "today" },
            { label: "This week", value: "week" },
            { label: "Last week", value: "last_week" },
            { label: "This month", value: "month" },
            { label: "Last month", value: "last_month" },
        ];
    const billingClinicLabel = language === "vi" ? "Chi nhánh" : "Clinic";
    const billingTimeLabel = language === "vi" ? "Thời gian" : "Time";
    return { billingWorkspace, journeyInvoiceIds, visibleClinics, language, bt, notice, canMutate, receiptDrafts, journeyServiceFilter, setJourneyServiceFilter, billingClinicFilter, setBillingClinicFilter, billingPeriodFilter, setBillingPeriodFilter, billingInvoiceFilter, setBillingInvoiceFilter, billingSection, setBillingSection, selectBillingPatient, billingClinicOptions, periodAppointments, scopedBillingPatients, selectedBillingPatient, formPatients, formReady, dueDate, visiblePatientsById, periodJourneyServices, serviceCollectedAmount, serviceCreditAllocationAmount, serviceAppliedAmount, journeyServicesById, journeyServicesByInvoiceId, activeServiceInvoices, serviceInvoicedAmount, serviceRemainingInvoiceCapacity, serviceUninvoicedAmount, updateReceiptDraft, billingInvoiceAmount, billingInvoicePaidAmount, billingInvoiceBalance, journeyServiceInvoiceSnapshot, journeyFilterOptions, filteredJourneyServices, invoiceFilterOptions, filteredInvoices, openTotal, allocatedTotal, issuedInvoiceTotal, overdueInvoices, overdueInvoiceTotal, plannedDepositServices, plannedDepositTotal, receiptTotal, unappliedReceiptTotal, creditBalanceAllocationReceipts, recentDatabaseReceipts, activeCreditBalances, selectedBillingPatientBalanceAmount, selectedBillingPatientDirectReceiptTotal, patientBillingRows, adjustableInvoices, refundableInvoices, visibleStatementLines, visiblePaymentPlanReminders, visiblePaymentPlans, billingAdvancedLabels, remainingJourneyTotal, billingResultScopeActive, billingSearchSummary, billingSectionOptions, billingPeriodOptions, billingClinicLabel, billingTimeLabel };
}
export type BillingPanelModel = ReturnType<typeof useBillingPanelModel>;
