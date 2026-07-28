"use client";

import { ClipboardList, Settings, Trash2, WalletCards, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import {
  addServiceMaterialAction,
  addServiceStepAction,
  createCompensationPolicyAction,
  createServiceCatalogItemAction,
  deleteCompensationPolicyAction,
  deleteServiceCatalogItemAction,
  updateServiceCatalogItemAction,
  updateServiceStepAction,
} from "@/app/(app)/services/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { MoneyInput } from "@/components/MoneyInput";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import type { ServicesWorkspace } from "@/lib/services-types";

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, _language: Language) {
  return message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "services-service-saved": { vi: "\u0110\u00e3 l\u01b0u d\u1ecbch v\u1ee5.", en: "Service saved." },
    "services-policy-saved": { vi: "\u0110\u00e3 l\u01b0u ch\u00ednh s\u00e1ch l\u01b0\u01a1ng.", en: "Pay policy saved." },
    "services-policy-deleted": { vi: "\u0110\u00e3 x\u00f3a ho\u1eb7c ng\u01b0ng ch\u00ednh s\u00e1ch l\u01b0\u01a1ng.", en: "Pay policy deleted or retired." },
    "services-deleted": { vi: "Đã xóa hoặc ngừng sử dụng dịch vụ.", en: "Service deleted or retired." },
    "services-step-saved": { vi: "\u0110\u00e3 l\u01b0u b\u01b0\u1edbc d\u1ecbch v\u1ee5.", en: "Service step saved." },
    "services-material-saved": { vi: "\u0110\u00e3 l\u01b0u \u0111\u1ecbnh m\u1ee9c v\u1eadt t\u01b0.", en: "Service material saved." },
    "services-denied": { vi: "T\u00e0i kho\u1ea3n n\u00e0y kh\u00f4ng th\u1ec3 thay \u0111\u1ed5i d\u1ecbch v\u1ee5.", en: "This role cannot change services." },
    "services-missing": { vi: "\u0110i\u1ec1n \u0111\u1ee7 tr\u01b0\u1eddng d\u1ecbch v\u1ee5 b\u1eaft bu\u1ed9c.", en: "Complete the required service fields." },
    "services-not-found": { vi: "Kh\u00f4ng t\u00ecm th\u1ea5y d\u1ecbch v\u1ee5 ho\u1eb7c ch\u00ednh s\u00e1ch.", en: "The service or policy could not be found." },
    "services-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();

  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const viStatus: Record<string, string> = {
    ACTIVE: "\u0110ang ho\u1ea1t \u0111\u1ed9ng",
    DRAFT: "Nh\u00e1p",
    RETIRED: "Ng\u1eebng s\u1eed d\u1ee5ng",
  };

  return language === "vi" ? viStatus[status] ?? status : status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();
}

const defaultServicePolicyDraftShares = {
  consultant: 20,
  operator: 50,
  clinicalSupport: 30,
  assistantPrimary: 70,
  assistantSecondary: 30,
};

type ServicePolicyDraftShareKey = keyof typeof defaultServicePolicyDraftShares;

export function ServicesPanel({
  servicesWorkspace,
}: {
  servicesWorkspace?: ServicesWorkspace | null;
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const labels =
    language === "vi"
      ? {
          action: "Danh mục",
          addPolicy: "Tạo chính sách lương",
          addService: "Tạo dịch vụ",
          addMaterial: "Thêm vật tư",
          addStep: "Thêm bước",
          assistantPool: "Pool phụ tá %",
          assistantPrimary: "Phụ tá 1 %",
          assistantSecondary: "Phụ tá 2 %",
          cancel: "Hủy",
          catalog: "Thư viện dịch vụ",
          category: "Nhóm dịch vụ",
          clinicalSupport: "Hỗ trợ chuyên môn %",
          close: "Đóng",
          code: "Mã",
          compensation: "Lương dịch vụ",
          configure: "Cấu hình",
          defaultPrice: "Giá mặc định",
          deletePolicyConfirm:
            "Bạn chắc chắn muốn xóa hoặc ngừng chính sách lương này? Dịch vụ đang dùng chính sách sẽ được gỡ liên kết.",
          deleteService: "Xóa dịch vụ",
          deleteServiceConfirm:
            "Bạn chắc chắn muốn xóa dịch vụ này? Nếu đã có lịch sử điều trị, hệ thống sẽ chỉ ngừng sử dụng để giữ dữ liệu.",
          details: "Thông tin",
          duration: "Phút dự kiến",
          heading: "Quản lý dịch vụ, giá, bước và chính sách lương",
          name: "Tên dịch vụ",
          nameEn: "Tên tiếng Anh",
          noPolicies: "Chưa có chính sách lương",
          noMatchingServices: "Không tìm thấy dịch vụ phù hợp",
          noServices: "Chưa có dịch vụ trong catalog",
          noMaterials: "Chưa có định mức vật tư",
          operator: "Thực hiện %",
          policyList: "Danh sách chính sách lương",
          policy: "Chính sách lương",
          policyCode: "Mã policy",
          policyName: "Tên policy",
          save: "Lưu",
          services: "Dịch vụ",
          status: "Trạng thái",
          stepDescription: "Mô tả bước",
          stepName: "Tên bước",
          stepProgress: "% tiến độ",
          targetMode: "Đối tượng",
          version: "Phiên bản",
          consultant: "Tư vấn %",
          doctorPool: "Pool bác sĩ %",
          inventoryItem: "Vật tư kho",
          material: "Định mức vật tư",
          materialName: "Tên vật tư",
          materialQuantity: "Số lượng",
          materialUnit: "Đơn vị",
          poolSummary: "Pool",
          requiredMaterial: "Bắt buộc",
          searchServices: "Tìm dịch vụ",
          searchServicesPlaceholder: "Mã, tên, nhóm, chính sách...",
          allCategories: "Tất cả nhóm",
          active: "Đang hoạt động",
          steps: "Bước",
          warning: "Cảnh báo",
        }
      : {
          action: "Catalog",
          addPolicy: "Create policy",
          addService: "Create service",
          addMaterial: "Add material",
          addStep: "Add step",
          assistantPool: "Assistant pool %",
          assistantPrimary: "Assistant 1 %",
          assistantSecondary: "Assistant 2 %",
          cancel: "Cancel",
          catalog: "Service catalog",
          category: "Category",
          clinicalSupport: "Clinical support %",
          close: "Close",
          code: "Code",
          compensation: "Service compensation",
          configure: "Configure",
          defaultPrice: "Default price",
          deletePolicyConfirm:
            "Delete or retire this pay policy? Services using it will be unlinked.",
          deleteService: "Delete service",
          deleteServiceConfirm:
            "Delete this service? If it already has treatment history, it will be retired to preserve records.",
          details: "Details",
          duration: "Expected minutes",
          heading: "Manage services, pricing, steps, and pay policies",
          name: "Service name",
          nameEn: "English name",
          noPolicies: "No pay policies yet",
          noMatchingServices: "No matching services",
          noServices: "No services in the catalog yet",
          noMaterials: "No material norms yet",
          operator: "Operator %",
          policyList: "Pay policy list",
          policy: "Pay policy",
          policyCode: "Policy code",
          policyName: "Policy name",
          save: "Save",
          services: "Services",
          status: "Status",
          stepDescription: "Step description",
          stepName: "Step name",
          stepProgress: "Progress %",
          targetMode: "Target",
          version: "Version",
          consultant: "Consultant %",
          doctorPool: "Doctor pool %",
          inventoryItem: "Inventory item",
          material: "Material norms",
          materialName: "Material name",
          materialQuantity: "Quantity",
          materialUnit: "Unit",
          poolSummary: "Pool",
          requiredMaterial: "Required",
          searchServices: "Search services",
          searchServicesPlaceholder: "Code, name, category, policy...",
          allCategories: "All categories",
          active: "Active",
          steps: "Steps",
          warning: "Warning",
        };
  const categories = servicesWorkspace?.categories ?? [];
  const policies = servicesWorkspace?.policies ?? [];
  const inventoryItems = servicesWorkspace?.inventoryItems ?? [];
  const services = servicesWorkspace?.services ?? [];
  const canMutate = servicesWorkspace?.canMutate ?? false;
  const canDeleteServices = servicesWorkspace?.canDelete ?? false;
  const [serviceModal, setServiceModal] = useState<"service" | "policy" | null>(
    null,
  );
  const [serviceSection, setServiceSection] = useState<"catalog" | "compensation">("catalog");
  const [serviceConfigTab, setServiceConfigTab] = useState<"details" | "steps" | "materials">("details");
  const [serviceSearchText, setServiceSearchText] = useState("");
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState("all");
  const [editingServiceId, setEditingServiceId] = useState("");
  const [policyDraftShares, setPolicyDraftShares] = useState(
    defaultServicePolicyDraftShares,
  );
  const editingService =
    services.find((service) => service.id === editingServiceId) ?? null;
  const activeCount = services.filter((service) => service.status === "ACTIVE").length;
  const stepCount = services.reduce(
    (total, service) => total + service.steps.length,
    0,
  );
  const policyDraftWarning = servicePolicyShareTotalsWarning(
    policyDraftShares.consultant +
      policyDraftShares.operator +
      policyDraftShares.clinicalSupport,
    policyDraftShares.assistantPrimary + policyDraftShares.assistantSecondary,
    language,
  );
  const normalizedServiceSearch = normalizeSearchText(serviceSearchText);
  const filteredServices = services.filter((service) => {
    const matchesCategory =
      serviceCategoryFilter === "all" || service.categoryCode === serviceCategoryFilter;
    const matchesSearch =
      !normalizedServiceSearch ||
      normalizeSearchText(
        [
          service.code,
          service.name,
          service.nameEn ?? "",
          service.categoryName,
          service.status,
          service.targetMode,
          service.defaultCompensationRuleName ?? "",
          String(service.defaultPrice),
        ].join(" "),
      ).includes(normalizedServiceSearch);

    return matchesCategory && matchesSearch;
  });
  const updatePolicyDraftShare =
    (key: ServicePolicyDraftShareKey) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number(event.currentTarget.value);

      setPolicyDraftShares((current) => ({
        ...current,
        [key]: Number.isFinite(parsed) ? parsed : 0,
      }));
    };

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{labels.action}</p>
          <h2>{labels.heading}</h2>
        </div>
        <SourceBadge source={servicesWorkspace?.source} />
      </div>

      {(servicesWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(servicesWorkspace?.message, language)}
        </div>
      )}

      <div className="metric-grid">
        <MetricCard label={labels.services} value={String(services.length)} tone="blue" />
        <MetricCard label={labels.active} value={String(activeCount)} tone="teal" />
        <MetricCard label={labels.policy} value={String(policies.length)} tone="green" />
        <MetricCard label={labels.steps} value={String(stepCount)} tone="violet" />
      </div>

      <div className="service-section-tabs" role="tablist" aria-label={labels.services}>
        <button
          className={serviceSection === "catalog" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={serviceSection === "catalog"}
          onClick={() => setServiceSection("catalog")}
        >
          {labels.catalog}
        </button>
        <button
          className={serviceSection === "compensation" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={serviceSection === "compensation"}
          onClick={() => setServiceSection("compensation")}
        >
          {labels.compensation}
        </button>
      </div>

      <div className="service-action-row">
        {serviceSection === "catalog" ? (
          <button
            className="primary-button"
            type="button"
            disabled={!canMutate || categories.length === 0}
            onClick={() => setServiceModal("service")}
          >
            <ClipboardList size={16} />
            {labels.addService}
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={!canMutate}
            onClick={() => {
              setPolicyDraftShares(defaultServicePolicyDraftShares);
              setServiceModal("policy");
            }}
          >
            <WalletCards size={16} />
            {labels.addPolicy}
          </button>
        )}
      </div>

      {serviceSection === "catalog" && (
        <div className="service-catalog-toolbar">
          <label>
            <span>{labels.searchServices}</span>
            <input
              value={serviceSearchText}
              onChange={(event) => setServiceSearchText(event.currentTarget.value)}
              placeholder={labels.searchServicesPlaceholder}
            />
          </label>
          <label>
            <span>{labels.category}</span>
            <select
              value={serviceCategoryFilter}
              onChange={(event) => setServiceCategoryFilter(event.currentTarget.value)}
            >
              <option value="all">{labels.allCategories}</option>
              {categories.map((category) => (
                <option value={category.code} key={category.id}>
                  {language === "en" ? category.nameEn ?? category.name : category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {serviceModal === "service" && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.addService}
          onClick={() => setServiceModal(null)}
        >
          <form
            action={createServiceCatalogItemAction}
            className="progress-modal service-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setServiceModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.catalog}</span>
                <h3>{labels.addService}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setServiceModal(null)}
                aria-label={labels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="progress-modal-grid service-modal-grid">
              <label>
                {labels.code}
                <input name="code" placeholder="LCR" disabled={!canMutate} required />
              </label>
              <label>
                {labels.name}
                <input name="name" disabled={!canMutate} required />
              </label>
              <label>
                {labels.nameEn}
                <input name="nameEn" disabled={!canMutate} />
              </label>
              <label>
                {labels.category}
                <select name="categoryId" disabled={!canMutate || categories.length === 0}>
                  {categories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {language === "en" ? category.nameEn ?? category.name : category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.defaultPrice}
                <MoneyInput name="defaultPrice" placeholder="1.800.000" disabled={!canMutate} required />
              </label>
              <label>
                {labels.duration}
                <input name="defaultDurationMinutes" inputMode="numeric" disabled={!canMutate} />
              </label>
              <label>
                {labels.policy}
                <select name="defaultCompensationRuleId" disabled={!canMutate}>
                  <option value="">{language === "vi" ? "Mặc định" : "Default"}</option>
                  {policies.map((policy) => (
                    <option value={policy.id} key={policy.id}>
                      {policy.code} - {policy.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="progress-modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setServiceModal(null)}
              >
                {labels.cancel}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!canMutate || categories.length === 0}
              >
                {labels.addService}
              </button>
            </div>
          </form>
        </div>
      )}

      {serviceModal === "policy" && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.addPolicy}
          onClick={() => setServiceModal(null)}
        >
          <form
            action={createCompensationPolicyAction}
            className="progress-modal service-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setServiceModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.policy}</span>
                <h3>{labels.addPolicy}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setServiceModal(null)}
                aria-label={labels.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="progress-modal-grid service-modal-grid">
              <label>
                {labels.policyCode}
                <input name="code" placeholder="POLICY2" disabled={!canMutate} required />
              </label>
              <label>
                {labels.policyName}
                <input name="name" disabled={!canMutate} required />
              </label>
              <label>
                {labels.version}
                <input name="version" defaultValue="1" disabled={!canMutate} />
              </label>
              <label>
                {labels.doctorPool}
                <input name="doctorPoolPercent" inputMode="decimal" defaultValue="10" disabled={!canMutate} />
              </label>
              <label>
                {labels.assistantPool}
                <input name="assistantPoolPercent" inputMode="decimal" defaultValue="2" disabled={!canMutate} />
              </label>
              <label>
                {labels.consultant}
                <input
                  name="consultantSharePercent"
                  inputMode="decimal"
                  defaultValue={String(defaultServicePolicyDraftShares.consultant)}
                  onChange={updatePolicyDraftShare("consultant")}
                  disabled={!canMutate}
                />
              </label>
              <label>
                {labels.operator}
                <input
                  name="operatorSharePercent"
                  inputMode="decimal"
                  defaultValue={String(defaultServicePolicyDraftShares.operator)}
                  onChange={updatePolicyDraftShare("operator")}
                  disabled={!canMutate}
                />
              </label>
              <label>
                {labels.clinicalSupport}
                <input
                  name="clinicalSupportSharePercent"
                  inputMode="decimal"
                  defaultValue={String(defaultServicePolicyDraftShares.clinicalSupport)}
                  onChange={updatePolicyDraftShare("clinicalSupport")}
                  disabled={!canMutate}
                />
              </label>
              <label>
                {labels.assistantPrimary}
                <input
                  name="assistantPrimarySharePercent"
                  inputMode="decimal"
                  defaultValue={String(defaultServicePolicyDraftShares.assistantPrimary)}
                  onChange={updatePolicyDraftShare("assistantPrimary")}
                  disabled={!canMutate}
                />
              </label>
              <label>
                {labels.assistantSecondary}
                <input
                  name="assistantSecondarySharePercent"
                  inputMode="decimal"
                  defaultValue={String(defaultServicePolicyDraftShares.assistantSecondary)}
                  onChange={updatePolicyDraftShare("assistantSecondary")}
                  disabled={!canMutate}
                />
              </label>
            </div>
            {policyDraftWarning && (
              <div className="schedule-alert action service-policy-warning">
                <strong>{labels.warning}</strong>
                <span>{policyDraftWarning}</span>
              </div>
            )}
            <div className="progress-modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setServiceModal(null)}
              >
                {labels.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate || Boolean(policyDraftWarning)}>
                {labels.addPolicy}
              </button>
            </div>
          </form>
        </div>
      )}

      {serviceSection === "compensation" && (
      <section className="panel">
        <PanelHeader icon={WalletCards} title={labels.policyList} action={`${policies.length}`} />
        <div className="service-catalog-list compact">
          {policies.length > 0 ? (
            policies.map((policy) => {
              const policyWarning = servicePolicyShareWarning(policy, language);

              return (
              <article className="service-catalog-card" key={policy.id}>
                <div className="service-catalog-head">
                  <div>
                    <span className="code-chip">{policy.code}</span>
                    <strong>{policy.name}</strong>
                    <small>
                      {labels.version} {policy.version} · {labels.poolSummary}:{" "}
                      {labels.doctorPool} {policy.doctorPoolPercent}% /{" "}
                      {labels.assistantPool} {policy.assistantPoolPercent}%
                    </small>
                  </div>
                  <div className="service-policy-actions">
                    <StatusPill status={policy.active ? "ACTIVE" : "RETIRED"} />
                    {canMutate && (
                      <form
                        action={deleteCompensationPolicyAction}
                        onSubmit={(event) => {
                          if (!window.confirm(labels.deletePolicyConfirm)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input name="policyId" type="hidden" value={policy.id} />
                        <button
                          className="icon-button small danger-icon"
                          type="submit"
                          aria-label={
                            language === "vi"
                              ? "Xóa chính sách lương"
                              : "Delete pay policy"
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {policyWarning && (
                  <div className="schedule-alert action service-policy-warning">
                    <strong>{labels.warning}</strong>
                    <span>{policyWarning}</span>
                  </div>
                )}
                <div className="service-steps">
                  <span>
                    {labels.consultant}: {policy.consultantSharePercent}%
                  </span>
                  <span>
                    {labels.operator}: {policy.operatorSharePercent}%
                  </span>
                  <span>
                    {labels.clinicalSupport}: {policy.clinicalSupportSharePercent}%
                  </span>
                  <span>
                    {labels.assistantPrimary}: {policy.assistantPrimarySharePercent}%
                  </span>
                  <span>
                    {labels.assistantSecondary}: {policy.assistantSecondarySharePercent}%
                  </span>
                </div>
              </article>
              );
            })
          ) : (
            <EmptyState label={labels.noPolicies} />
          )}
        </div>
      </section>
      )}

      {serviceSection === "catalog" && (
      <section className="panel">
        <PanelHeader
          icon={ClipboardList}
          title={labels.catalog}
          action={
            filteredServices.length === services.length
              ? `${services.length}`
              : `${filteredServices.length}/${services.length}`
          }
        />
        <div className="service-catalog-list">
          {filteredServices.length > 0 ? (
            filteredServices.map((service) => (
              <article className="service-catalog-card service-library-card" key={service.id}>
                <div className="service-catalog-head">
                  <div>
                    <span className="code-chip">{service.code}</span>
                    <strong>{service.name}</strong>
                    <small>
                      {service.categoryName} · {formatVnd(service.defaultPrice)} ·{" "}
                      {service.defaultCompensationRuleName ??
                        (language === "vi" ? "Chưa có chính sách" : "No policy")}
                    </small>
                  </div>
                  <div className="service-policy-actions">
                    <StatusPill status={service.status} />
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => {
                        setEditingServiceId(service.id);
                        setServiceConfigTab("details");
                      }}
                    >
                      <Settings size={16} />
                      {labels.configure}
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <EmptyState label={services.length > 0 ? labels.noMatchingServices : labels.noServices} />
          )}
        </div>
      </section>
      )}

      {editingService && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={editingService.name}
          onClick={() => setEditingServiceId("")}
        >
          <div
            className="progress-modal service-modal service-config-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="progress-modal-header">
              <div>
                <span>{editingService.code}</span>
                <h3>{editingService.name}</h3>
              </div>
              <button
                className="icon-button small"
                type="button"
                onClick={() => setEditingServiceId("")}
                aria-label={labels.close}
              >
                <X size={16} />
              </button>
            </div>

            <div className="service-config-tabs" role="tablist" aria-label={labels.configure}>
              <button
                className={serviceConfigTab === "details" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={serviceConfigTab === "details"}
                onClick={() => setServiceConfigTab("details")}
              >
                {labels.details}
              </button>
              <button
                className={serviceConfigTab === "steps" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={serviceConfigTab === "steps"}
                onClick={() => setServiceConfigTab("steps")}
              >
                {labels.steps}
              </button>
              <button
                className={serviceConfigTab === "materials" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={serviceConfigTab === "materials"}
                onClick={() => setServiceConfigTab("materials")}
              >
                {labels.material}
              </button>
            </div>

            {serviceConfigTab === "details" && (
            <>
              <form action={updateServiceCatalogItemAction} className="service-edit-form">
                <input name="serviceId" type="hidden" value={editingService.id} />
                <label>
                  {labels.name}
                  <input name="name" defaultValue={editingService.name} disabled={!canMutate} />
                </label>
                <label>
                  {labels.nameEn}
                  <input
                    name="nameEn"
                    defaultValue={editingService.nameEn ?? ""}
                    disabled={!canMutate}
                  />
                </label>
                <label>
                  {labels.defaultPrice}
                  <MoneyInput
                    name="defaultPrice"
                    defaultValue={String(editingService.defaultPrice)}
                    disabled={!canMutate}
                  />
                </label>
                <label>
                  {labels.duration}
                  <input
                    name="defaultDurationMinutes"
                    inputMode="numeric"
                    defaultValue={editingService.defaultDurationMinutes ?? ""}
                    disabled={!canMutate}
                  />
                </label>
                <label>
                  {labels.policy}
                  <select
                    name="defaultCompensationRuleId"
                    defaultValue={editingService.defaultCompensationRuleId ?? ""}
                    disabled={!canMutate}
                  >
                    <option value="">{language === "vi" ? "Mặc định" : "Default"}</option>
                    {policies.map((policy) => (
                      <option value={policy.id} key={policy.id}>
                        {policy.code} - {policy.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {labels.status}
                  <select name="status" defaultValue={editingService.status} disabled={!canMutate}>
                    <option value="DRAFT">{displayStatus("DRAFT", language)}</option>
                    <option value="ACTIVE">{displayStatus("ACTIVE", language)}</option>
                    <option value="RETIRED" disabled={!canDeleteServices && editingService.status !== "RETIRED"}>
                      {displayStatus("RETIRED", language)}
                    </option>
                  </select>
                </label>
                <button type="submit" disabled={!canMutate}>
                  {labels.save}
                </button>
              </form>
              {canDeleteServices && (
                <form
                  action={deleteServiceCatalogItemAction}
                  className="service-danger-form"
                  onSubmit={(event) => {
                    if (!window.confirm(labels.deleteServiceConfirm)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input name="serviceId" type="hidden" value={editingService.id} />
                  <button className="danger-button" type="submit">
                    <Trash2 size={16} />
                    {labels.deleteService}
                  </button>
                </form>
              )}
            </>
            )}

            {serviceConfigTab === "steps" && (
            <>
            <div className="service-step-edit-list">
              {editingService.steps.map((step) => (
                <form
                  action={updateServiceStepAction}
                  className="service-step-edit-form"
                  key={step.id}
                >
                  <input name="stepId" type="hidden" value={step.id} />
                  <span>{step.sequence}</span>
                  <input
                    aria-label={labels.stepName}
                    name="name"
                    defaultValue={step.name}
                    disabled={!canMutate}
                    required
                  />
                  <input
                    aria-label={labels.stepDescription}
                    name="description"
                    defaultValue={step.description ?? ""}
                    placeholder={labels.stepDescription}
                    disabled={!canMutate}
                  />
                  <input
                    aria-label={labels.stepProgress}
                    name="defaultProgress"
                    inputMode="numeric"
                    defaultValue={step.defaultProgress ?? ""}
                    disabled={!canMutate}
                  />
                  <input
                    aria-label={labels.duration}
                    name="expectedMinutes"
                    inputMode="numeric"
                    defaultValue={step.expectedMinutes ?? ""}
                    disabled={!canMutate}
                  />
                  <button type="submit" disabled={!canMutate}>
                    {labels.save}
                  </button>
                </form>
              ))}
            </div>

            <form action={addServiceStepAction} className="service-step-form">
              <input name="serviceId" type="hidden" value={editingService.id} />
              <input
                name="name"
                placeholder={labels.stepName}
                disabled={!canMutate}
                required
              />
              <input
                name="description"
                placeholder={labels.stepDescription}
                disabled={!canMutate}
              />
              <input
                name="defaultProgress"
                inputMode="numeric"
                placeholder={labels.stepProgress}
                disabled={!canMutate}
              />
              <input
                name="expectedMinutes"
                inputMode="numeric"
                placeholder={labels.duration}
                disabled={!canMutate}
              />
              <button type="submit" disabled={!canMutate}>
                {labels.addStep}
              </button>
            </form>
            </>
            )}

            {serviceConfigTab === "materials" && (
            <>
            <div className="service-steps">
              {editingService.materials.length > 0 ? (
                editingService.materials.map((material) => (
                  <span key={material.id}>
                    {material.itemCode ?? material.name}: {material.quantity ?? 0}{" "}
                    {material.unit ?? ""}
                  </span>
                ))
              ) : (
                <span>{labels.noMaterials}</span>
              )}
            </div>

            <form action={addServiceMaterialAction} className="service-step-form">
              <input name="serviceId" type="hidden" value={editingService.id} />
              <select name="inventoryItemId" disabled={!canMutate}>
                <option value="">{labels.inventoryItem}</option>
                {inventoryItems.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.code} - {item.name} ({item.onHandQuantity} {item.unit})
                  </option>
                ))}
              </select>
              <input
                name="name"
                placeholder={labels.materialName}
                disabled={!canMutate}
                required
              />
              <input
                name="quantity"
                inputMode="decimal"
                placeholder={labels.materialQuantity}
                disabled={!canMutate}
                required
              />
              <input name="unit" placeholder={labels.materialUnit} disabled={!canMutate} />
              <label className="inline-checkbox">
                <input name="required" type="checkbox" disabled={!canMutate} />
                {labels.requiredMaterial}
              </label>
              <button type="submit" disabled={!canMutate}>
                {labels.addMaterial}
              </button>
            </form>
            </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function servicePolicyShareWarning(
  policy: ServicesWorkspace["policies"][number],
  language: Language,
) {
  const doctorShares =
    policy.consultantSharePercent +
    policy.operatorSharePercent +
    policy.clinicalSupportSharePercent;
  const assistantShares =
    policy.assistantPrimarySharePercent + policy.assistantSecondarySharePercent;

  return servicePolicyShareTotalsWarning(doctorShares, assistantShares, language);
}

function servicePolicyShareTotalsWarning(
  doctorShares: number,
  assistantShares: number,
  language: Language,
) {
  const warnings: string[] = [];

  if (doctorShares > 100) {
    warnings.push(
      language === "vi"
        ? `Tổng chia pool bác sĩ đang là ${doctorShares}%, vượt 100%.`
        : `Doctor pool shares total ${doctorShares}%, above 100%.`,
    );
  }

  if (assistantShares > 100) {
    warnings.push(
      language === "vi"
        ? `Tổng chia pool phụ tá đang là ${assistantShares}%, vượt 100%.`
        : `Assistant pool shares total ${assistantShares}%, above 100%.`,
    );
  }

  return warnings.join(" ");
}
