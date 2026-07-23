import "server-only";

export const notificationTemplates = {
  APPOINTMENT_REMINDER: {
    subject: "Nhắc lịch hẹn",
    body: "Xin chào {{patientName}}, bạn có lịch hẹn tại {{clinicName}} vào {{appointmentAt}}.",
  },
  PAYMENT_REMINDER: {
    subject: "Nhắc thanh toán",
    body: "Xin chào {{patientName}}, khoản cần thanh toán {{amount}} đến hạn vào {{dueAt}}.",
  },
  LEARNING_ASSIGNMENT: {
    subject: "Bài đào tạo mới",
    body: "Bạn được giao bài đào tạo: {{contentTitle}}.",
  },
  RECALL_REMINDER: {
    subject: "Nhắc tái khám",
    body: "Xin chào {{patientName}}, phòng khám mời bạn đặt lịch tái khám cho {{serviceName}}.",
  },
  PRESCRIPTION_READY: {
    subject: "Đơn thuốc đã sẵn sàng",
    body: "Đơn thuốc {{prescriptionNo}} của bạn đã được ký và sẵn sàng xem trên cổng bệnh nhân.",
  },
  CONSENT_FORM: {
    subject: "Biểu mẫu cần xác nhận",
    body: "Xin chào {{patientName}}, vui lòng hoàn tất biểu mẫu {{formName}} trước buổi hẹn.",
  },
  PASSWORD_RESET: {
    subject: "Reset your Codexdentist password",
    body: [
      "Hello {{fullName}},",
      "",
      "Use this one-time link to reset your Codexdentist password:",
      "{{resetUrl}}",
      "",
      "This link expires at {{expiresAt}}.",
      "",
      "If you did not request this email, you can ignore it.",
    ].join("\n"),
  },
  STAFF_PASSWORD_SETUP: {
    subject: "Codexdentist password setup",
    body: [
      "Hello {{fullName}},",
      "",
      "Use this one-time link to set your Codexdentist password:",
      "{{setupUrl}}",
      "",
      "This link expires at {{expiresAt}}.",
    ].join("\n"),
  },
} as const;

export type NotificationTemplateKey = keyof typeof notificationTemplates;

export function renderNotificationTemplate(
  templateKey: NotificationTemplateKey,
  values: Record<string, string | number | null | undefined>,
) {
  const template = notificationTemplates[templateKey];

  return {
    subject: render(template.subject, values),
    body: render(template.body, values),
  };
}

function render(template: string, values: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    String(values[key] ?? ""),
  );
}
