export function getBillingAdvancedLabels(input: {
    language: import("@/components/AppLanguage").Language;
}) {
    const { language } = input;
    return language === "vi"
        ? {
            adjustment: "Điều chỉnh hóa đơn",
            amountNew: "Tổng tiền mới",
            confirmAdjust: "Bạn chắc chắn muốn điều chỉnh tổng tiền hóa đơn này? Thao tác sẽ ghi audit log.",
            confirmIssueInvoice: "Bạn chắc chắn muốn xuất hóa đơn cho phần đã thu/chưa xuất hóa đơn?",
            confirmReceipt: "Bạn chắc chắn muốn ghi nhận khoản thu này?",
            confirmReceiptAndInvoice: "Bạn chắc chắn muốn ghi nhận khoản thu và xuất hóa đơn tương ứng?",
            confirmRefund: "Bạn chắc chắn muốn ghi nhận hoàn tiền cho hóa đơn này?",
            confirmVoid: "Bạn chắc chắn muốn hủy hóa đơn này?",
            paymentPlan: "Nhắc trả góp",
            refund: "Hoàn tiền",
            refundAmount: "Số tiền hoàn",
            audit: "Audit",
            ledger: "Sổ cái",
            reminderDate: "Ngày nhắc",
            statement: "Lịch sử thu và khoản phải thu",
            reason: "Lý do/ghi chú",
            installmentCount: "Số kỳ",
            intervalDays: "Khoảng cách ngày",
            firstDueAt: "Kỳ đầu",
            paymentPlanList: "Lịch trả góp",
        }
        : {
            adjustment: "Invoice adjustment",
            amountNew: "New total",
            confirmAdjust: "Are you sure you want to adjust this invoice total? This will write an audit log.",
            confirmIssueInvoice: "Are you sure you want to issue an invoice for the collected uninvoiced amount?",
            confirmReceipt: "Are you sure you want to record this receipt?",
            confirmReceiptAndInvoice: "Are you sure you want to record this receipt and issue the matching invoice?",
            confirmRefund: "Are you sure you want to record this invoice refund?",
            confirmVoid: "Are you sure you want to void this invoice?",
            paymentPlan: "Payment plan reminder",
            refund: "Refund",
            refundAmount: "Refund amount",
            audit: "Audit",
            ledger: "Ledger",
            reminderDate: "Reminder date",
            statement: "Patient payment history",
            reason: "Reason/note",
            installmentCount: "Installments",
            intervalDays: "Interval days",
            firstDueAt: "First due",
            paymentPlanList: "Payment plan schedule",
        };
}
