export const optionalProviders = ["orthanc", "chatwoot", "novu", "medplum"] as const;
export type OptionalProvider = typeof optionalProviders[number];
export type OptionalProviderField = { key: string; label: string; secret: boolean; required: boolean;
  defaultValue?: string; options?: Array<{ value: string; label: string }> };
export type OptionalProviderDefinition = { provider: OptionalProvider; name: string; description: string; fields: OptionalProviderField[] };
export type OptionalConnectionSummary = { id: string; clinicId: string | null; status: string; configured: boolean;
  verified: boolean; verifiedAt: string | null; hasReferences: boolean };
export type OptionalProviderWorkspace = { definition: OptionalProviderDefinition; clinics: Array<{id:string;name:string}>;
  canManageOrganization: boolean; isDemo: boolean; connections: OptionalConnectionSummary[] };
export function isOptionalProvider(value: string): value is OptionalProvider {
  return (optionalProviders as readonly string[]).includes(value);
}
const field = (key: string, label: string, secret = false): OptionalProviderField => ({ key, label, secret, required: true });
export const optionalProviderDefinitions: Record<OptionalProvider, OptionalProviderDefinition> = {
  orthanc: { provider: "orthanc", name: "Orthanc / OHIF", description: "Kết nối kho phim tự host; nhân viên chỉ xem phim đã liên kết đúng bệnh nhân và phòng khám.",
    fields: [field("baseUrl", "Địa chỉ kho phim"), field("username", "Tên đăng nhập"), field("password", "Mật khẩu", true)] },
  chatwoot: { provider: "chatwoot", name: "Chatwoot", description: "Hội thoại chăm sóc qua máy chủ Chatwoot Community của phòng khám. Không tự gửi tin nhắn khi tạo liên kết.",
    fields: [field("baseUrl", "Địa chỉ Chatwoot API"), { ...field("publicBaseUrl", "Địa chỉ Chatwoot cho nhân viên (HTTPS)"), required: false },
      field("apiToken", "API Token", true), field("accountId", "Account ID"), field("inboxId", "Inbox ID")] },
  novu: { provider: "novu", name: "Novu", description: "Thông báo qua máy chủ Novu Community tự host. Mặc định dùng thông báo nội bộ; email cần SMTP riêng đã cấu hình.",
    fields: [field("baseUrl", "Địa chỉ Novu"), field("apiKey", "API Key", true), field("environmentId", "Environment ID"), field("workflowId", "Workflow ID"),
      field("testSubscriberId", "Người nhận kiểm thử cdx-test-*"), { ...field("deliveryChannel", "Kênh thông báo"), defaultValue: "in_app",
        options: [{ value: "in_app", label: "Thông báo nội bộ" }, { value: "email", label: "Email qua SMTP tự quản lý" }] }] },
  medplum: { provider: "medplum", name: "Medplum", description: "Gửi bản thông tin hành chính theo chuẩn FHIR đến Medplum tự host. Hồ sơ tại Codexdentist vẫn là bản chính.",
    fields: [field("baseUrl", "Địa chỉ Medplum API"), field("clientId", "Client ID"), field("clientSecret", "Client Secret", true), field("projectId", "Project ID")] },
};
