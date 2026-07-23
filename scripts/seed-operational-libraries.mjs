import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const seedVersion = "pilot-ops-2026-05";

const serviceCategories = [
  ["diagnostics", "Khám và chẩn đoán", "Diagnostics", 10],
  ["preventive", "Dự phòng", "Preventive", 20],
  ["restorative", "Phục hồi", "Restorative", 30],
  ["endodontics", "Nội nha", "Endodontics", 40],
  ["periodontics", "Nha chu", "Periodontics", 50],
  ["surgery", "Phẫu thuật", "Oral surgery", 60],
  ["prosthodontics", "Phục hình", "Prosthodontics", 70],
  ["implant", "Implant", "Implant", 80],
  ["orthodontics", "Chỉnh nha", "Orthodontics", 90],
  ["pediatric", "Nha trẻ em", "Pediatric dentistry", 100],
  ["emergency", "Cấp cứu", "Emergency", 110],
  ["lab-digital", "Labo và kỹ thuật số", "Lab and digital", 120],
];

const supplementalServices = [
  ["TMJ", "diagnostics", "Khám khớp thái dương hàm", "TMJ/TMD assessment", 600000, 60, "MOUTH", true],
  ["PHOT", "diagnostics", "Bộ ảnh trong miệng chuẩn hóa", "Clinical photo series", 250000, 30, "MOUTH", false],
  ["SCAN", "lab-digital", "Scan trong miệng", "Intraoral scan", 600000, 40, "MOUTH", false],
  ["MODEL3D", "lab-digital", "In mẫu 3D", "3D printed model", 450000, 45, "ARCH", false],
  ["WAXUP", "lab-digital", "Wax-up / mock-up thẩm mỹ", "Diagnostic wax-up / mock-up", 2500000, 90, "TOOTH_OR_GROUP", false],
  ["DSD", "lab-digital", "Thiết kế nụ cười kỹ thuật số", "Digital smile design", 3000000, 120, "MOUTH", false],
  ["AIRFLOW", "preventive", "Làm sạch Biofilm Airflow", "Airflow biofilm cleaning", 850000, 60, "MOUTH", false],
  ["MOUTHGUARD", "prosthodontics", "Máng bảo vệ thể thao", "Sports mouthguard", 1800000, 60, "ARCH", false],
  ["OCC-GUARD", "prosthodontics", "Máng chống nghiến nâng cao", "Occlusal splint", 2800000, 80, "ARCH", false],
  ["CROWN-TEMP", "prosthodontics", "Mão tạm", "Temporary crown", 900000, 60, "TOOTH", false],
  ["CROWN-PFM", "prosthodontics", "Mão sứ kim loại", "PFM crown", 2800000, 120, "TOOTH", false],
  ["CROWN-EMAX", "prosthodontics", "Mão/Veneer E.max", "E.max ceramic restoration", 8000000, 150, "TOOTH", false],
  ["DENTURE-FLEX", "prosthodontics", "Hàm tháo lắp nhựa dẻo", "Flexible removable denture", 6500000, 140, "TOOTH_OR_GROUP", false],
  ["DENTURE-FRAME", "prosthodontics", "Hàm khung kim loại", "Cast partial denture", 8500000, 150, "TOOTH_OR_GROUP", false],
  ["IMPL-GUIDE", "implant", "Máng hướng dẫn phẫu thuật implant", "Implant surgical guide", 3500000, 90, "TOOTH_OR_GROUP", true],
  ["IMPL-ALLON4", "implant", "Phục hình toàn hàm trên implant", "Full-arch implant restoration", 180000000, 360, "ARCH", true],
  ["ALVEO", "surgery", "Nạo ổ viêm / sửa sống hàm", "Alveoloplasty / socket debridement", 2500000, 90, "TOOTH_OR_GROUP", true],
  ["FRENECT", "surgery", "Cắt thắng môi/lưỡi", "Frenectomy", 1800000, 60, "TOOTH_OR_GROUP", true],
  ["MINISCREW", "orthodontics", "Mini vít chỉnh nha", "Orthodontic mini-screw", 2500000, 45, "TOOTH_OR_GROUP", true],
  ["ORTHO-ACT", "orthodontics", "Tái khám chỉnh nha định kỳ", "Orthodontic activation visit", 500000, 35, "MOUTH", false],
  ["CLEAR-RETAINER", "orthodontics", "Hàm duy trì trong suốt", "Clear retainer", 1800000, 45, "ARCH", false],
  ["SPACE-REG", "pediatric", "Tái khám dự phòng trẻ em", "Pediatric preventive recall", 200000, 30, "MOUTH", false],
  ["SDF", "pediatric", "Chấm SDF kiểm soát sâu răng", "SDF caries arrest", 350000, 30, "TOOTH_OR_GROUP", false],
  ["TRAUMA-SPLINT", "emergency", "Nẹp răng chấn thương", "Dental trauma splint", 2200000, 70, "TOOTH_OR_GROUP", true],
];

const serviceMaterialMap = {
  KHAM: [["BIB-PATIENT", 1, "cái"], ["GANG-NITRILE-M", 0.08, "hộp"], ["MASK-3L", 0.04, "hộp"]],
  LCR: [["PROPHY-PASTE", 0.1, "hộp"], ["PROPHY-CUP", 0.08, "hộp"], ["SUCTION-TIP", 0.05, "túi"], ["BIB-PATIENT", 1, "cái"]],
  AIRFLOW: [["AIRFLOW-POWDER", 1, "gói"], ["PROPHY-CUP", 0.05, "hộp"], ["BIB-PATIENT", 1, "cái"]],
  TRC: [["COMPOSITE-A2", 0.08, "tuýp"], ["BOND-UNIV", 0.03, "chai"], ["ETCH-37", 0.08, "ống"], ["MATRIX-SECTIONAL", 0.04, "hộp"]],
  TRG: [["GIC-RESTORE", 0.08, "bộ"], ["COTTON-ROLL", 0.05, "gói"]],
  CTU: [["ENDO-FILE-25", 0.2, "vỉ"], ["ENDO-FILE-30", 0.15, "vỉ"], ["GUTTA-F2", 0.1, "hộp"], ["SEALER-ENDO", 0.08, "bộ"], ["NAOCL-3", 0.15, "chai"], ["RUBBER-DAM", 0.1, "hộp"]],
  NHO: [["ANES-LIDO-EPI", 2, "ống"], ["NEEDLE-27G", 0.05, "hộp"], ["GAUZE-STERILE", 0.1, "hộp"], ["SUTURE-4-0", 0.08, "hộp"]],
  NRK: [["ANES-LIDO-EPI", 3, "ống"], ["SURG-BLADE-15C", 0.08, "hộp"], ["SUTURE-4-0", 0.15, "hộp"], ["IMPLANT-DRAPE", 1, "bộ"]],
  MSU: [["IMPRESSION-PVS", 0.12, "bộ"], ["TEMP-CROWN", 0.12, "bộ"], ["CEMENT-RESIN", 0.08, "bộ"], ["RETRACTION-CORD", 0.08, "hộp"]],
  ZIR: [["IMPRESSION-PVS", 0.12, "bộ"], ["CEMENT-RESIN", 0.08, "bộ"], ["RETRACTION-CORD", 0.08, "hộp"]],
  VNR: [["IMPRESSION-PVS", 0.1, "bộ"], ["CEMENT-RESIN", 0.08, "bộ"], ["TEMP-CROWN", 0.08, "bộ"]],
  IMPL: [["IMPLANT-DRAPE", 1, "bộ"], ["SUTURE-4-0", 0.2, "hộp"], ["SURG-BLADE-15C", 0.1, "hộp"], ["ANES-LIDO-EPI", 3, "ống"]],
  "IMPL-GUIDE": [["SURG-GUIDE-SLEEVE", 1, "bộ"], ["IMPLANT-DRAPE", 1, "bộ"]],
  CHN: [["ORTHO-BRACKET", 1, "bộ"], ["ORTHO-WIRE", 1, "bộ"], ["ORTHO-ELASTIC", 1, "gói"]],
  ALN: [["ALIGNER-ATTACH", 1, "bộ"], ["SCAN", 1, "lần"]],
  "ORTHO-ACT": [["ORTHO-WIRE", 0.15, "bộ"], ["ORTHO-ELASTIC", 0.2, "gói"]],
};

const suppliers = [
  ["NCC-HUFRIEDY", "Hu-Friedy / Crosstex", "028 7300 1001", "orders@hufriedy.example", "Dụng cụ phẫu thuật, vô trùng, kiểm soát nhiễm khuẩn"],
  ["NCC-3M", "3M Oral Care", "028 3824 5252", "oralcare@3m.example", "Vật liệu phục hồi, lấy dấu, cement"],
  ["NCC-DENTSPLY", "Dentsply Sirona", "028 7100 1122", "sales@dentsply.example", "Nội nha, phục hình, thiết bị"],
  ["NCC-GC", "GC Asia Dental", "028 7100 2200", "orders@gc.example", "GIC, composite, vật liệu dự phòng"],
  ["NCC-STRAUMANN", "Straumann Group", "028 7300 8899", "implant@straumann.example", "Implant và phục hình implant"],
  ["NCC-ORTHO", "Ortho Supply Vietnam", "024 7300 6688", "orders@ortho-supply.example", "Vật tư chỉnh nha"],
  ["NCC-EQUIP", "Thiết bị Nha Khoa Á Châu", "028 7109 8899", "service@achau-dental.example", "Thiết bị, bảo trì, phụ tùng"],
  ["NCC-GENERAL", "Dental Supply Việt Nam", "024 7300 6688", "orders@dental-supply.example", "Vật tư tiêu hao tổng hợp"],
];

const inventoryItems = [
  ["GANG-NITRILE-S", "Găng tay nitrile size S", "Kiểm soát nhiễm khuẩn", "hộp", 10, 40, 95000, false, "NCC-GENERAL"],
  ["GANG-NITRILE-M", "Găng tay nitrile size M", "Kiểm soát nhiễm khuẩn", "hộp", 12, 60, 95000, false, "NCC-GENERAL"],
  ["GANG-NITRILE-L", "Găng tay nitrile size L", "Kiểm soát nhiễm khuẩn", "hộp", 6, 24, 98000, false, "NCC-GENERAL"],
  ["MASK-3L", "Khẩu trang y tế 3 lớp", "Kiểm soát nhiễm khuẩn", "hộp", 15, 60, 42000, false, "NCC-GENERAL"],
  ["FACE-SHIELD", "Kính/face shield bảo hộ", "Kiểm soát nhiễm khuẩn", "cái", 8, 20, 45000, false, "NCC-GENERAL"],
  ["BIB-PATIENT", "Yếm nha khoa chống thấm", "Vật tư tiêu hao ghế", "túi", 12, 42, 68000, false, "NCC-GENERAL"],
  ["SUCTION-TIP", "Đầu hút phẫu thuật vô trùng", "Vật tư tiêu hao ghế", "túi", 8, 20, 145000, false, "NCC-HUFRIEDY"],
  ["SALIVA-EJECTOR", "Ống hút nước bọt", "Vật tư tiêu hao ghế", "túi", 15, 45, 38000, false, "NCC-GENERAL"],
  ["COTTON-ROLL", "Bông cuộn nha khoa", "Vật tư tiêu hao ghế", "gói", 12, 35, 52000, false, "NCC-GENERAL"],
  ["GAUZE-STERILE", "Gạc vô trùng 5x5", "Vật tư vô trùng", "hộp", 12, 28, 62000, true, "NCC-HUFRIEDY"],
  ["POUCH-STERILE-S", "Túi ép vô trùng size S", "Vô trùng dụng cụ", "cuộn", 4, 9, 165000, false, "NCC-HUFRIEDY"],
  ["POUCH-STERILE-M", "Túi ép vô trùng size M", "Vô trùng dụng cụ", "cuộn", 4, 10, 185000, false, "NCC-HUFRIEDY"],
  ["POUCH-STERILE-L", "Túi ép vô trùng size L", "Vô trùng dụng cụ", "cuộn", 3, 7, 240000, false, "NCC-HUFRIEDY"],
  ["AUTOCLAVE-IND", "Chỉ thị hấp tiệt trùng", "Vô trùng dụng cụ", "hộp", 4, 10, 280000, true, "NCC-HUFRIEDY"],
  ["DISINF-SURFACE", "Dung dịch khử khuẩn bề mặt", "Vô trùng dụng cụ", "chai", 10, 24, 120000, true, "NCC-HUFRIEDY"],
  ["HANDPIECE-OIL", "Dầu tra tay khoan", "Bảo trì thiết bị", "chai", 3, 8, 260000, false, "NCC-EQUIP"],
  ["ANES-LIDO-EPI", "Lidocaine 2% có Epinephrine", "Thuốc và vật tư gây tê", "ống", 80, 220, 8500, true, "NCC-GENERAL"],
  ["ANES-MEPI", "Mepivacaine 3%", "Thuốc và vật tư gây tê", "ống", 30, 80, 12000, true, "NCC-GENERAL"],
  ["NEEDLE-27G", "Kim gây tê nha khoa 27G", "Thuốc và vật tư gây tê", "hộp", 5, 14, 155000, true, "NCC-GENERAL"],
  ["NEEDLE-30G", "Kim gây tê nha khoa 30G", "Thuốc và vật tư gây tê", "hộp", 5, 12, 158000, true, "NCC-GENERAL"],
  ["COMPOSITE-A1", "Composite trám răng A1", "Vật liệu phục hồi", "tuýp", 4, 9, 420000, true, "NCC-3M"],
  ["COMPOSITE-A2", "Composite trám răng A2", "Vật liệu phục hồi", "tuýp", 6, 16, 420000, true, "NCC-3M"],
  ["COMPOSITE-A3", "Composite trám răng A3", "Vật liệu phục hồi", "tuýp", 6, 14, 420000, true, "NCC-3M"],
  ["BOND-UNIV", "Bonding universal", "Vật liệu phục hồi", "chai", 4, 9, 760000, true, "NCC-3M"],
  ["ETCH-37", "Acid etch 37%", "Vật liệu phục hồi", "ống", 10, 25, 65000, true, "NCC-3M"],
  ["MATRIX-SECTIONAL", "Khuôn trám sectional matrix", "Vật liệu phục hồi", "hộp", 3, 8, 480000, false, "NCC-3M"],
  ["GIC-RESTORE", "Glass ionomer phục hồi", "Vật liệu phục hồi", "bộ", 3, 8, 620000, true, "NCC-GC"],
  ["RUBBER-DAM", "Rubber dam", "Nội nha", "hộp", 3, 8, 320000, false, "NCC-DENTSPLY"],
  ["ENDO-FILE-20", "Trâm nội nha rotary size 20", "Nội nha", "vỉ", 5, 12, 185000, true, "NCC-DENTSPLY"],
  ["ENDO-FILE-25", "Trâm nội nha rotary size 25", "Nội nha", "vỉ", 5, 16, 185000, true, "NCC-DENTSPLY"],
  ["ENDO-FILE-30", "Trâm nội nha rotary size 30", "Nội nha", "vỉ", 5, 14, 185000, true, "NCC-DENTSPLY"],
  ["GUTTA-F2", "Gutta percha F2", "Nội nha", "hộp", 3, 9, 210000, true, "NCC-DENTSPLY"],
  ["SEALER-ENDO", "Sealer hàn ống tủy", "Nội nha", "bộ", 2, 6, 820000, true, "NCC-DENTSPLY"],
  ["NAOCL-3", "NaOCl 3%", "Nội nha", "chai", 6, 18, 75000, true, "NCC-DENTSPLY"],
  ["CHX-2", "Chlorhexidine 2%", "Nội nha", "chai", 4, 12, 125000, true, "NCC-DENTSPLY"],
  ["ALGINATE", "Bột lấy dấu Alginate", "Lấy dấu và phục hình", "túi", 6, 20, 145000, true, "NCC-GC"],
  ["IMPRESSION-PVS", "Silicone lấy dấu PVS", "Lấy dấu và phục hình", "bộ", 4, 10, 980000, true, "NCC-3M"],
  ["TEMP-CROWN", "Vật liệu làm răng tạm", "Lấy dấu và phục hình", "bộ", 3, 7, 620000, true, "NCC-3M"],
  ["CEMENT-RESIN", "Cement resin gắn phục hình", "Lấy dấu và phục hình", "bộ", 3, 8, 1250000, true, "NCC-3M"],
  ["RETRACTION-CORD", "Chỉ co nướu", "Lấy dấu và phục hình", "hộp", 2, 6, 520000, true, "NCC-GC"],
  ["PROPHY-PASTE", "Paste đánh bóng", "Dự phòng và nha chu", "hộp", 4, 14, 210000, true, "NCC-GC"],
  ["PROPHY-CUP", "Chổi/cup đánh bóng", "Dự phòng và nha chu", "hộp", 4, 16, 135000, false, "NCC-GC"],
  ["AIRFLOW-POWDER", "Bột Airflow prophylaxis", "Dự phòng và nha chu", "gói", 8, 24, 85000, true, "NCC-GC"],
  ["FLUORIDE-VARNISH", "Fluoride varnish", "Dự phòng và nha chu", "hộp", 2, 8, 720000, true, "NCC-GC"],
  ["SDF-38", "Silver diamine fluoride 38%", "Nha trẻ em", "chai", 1, 4, 950000, true, "NCC-GC"],
  ["SUTURE-4-0", "Chỉ khâu phẫu thuật 4-0", "Phẫu thuật", "hộp", 4, 10, 520000, true, "NCC-HUFRIEDY"],
  ["SUTURE-5-0", "Chỉ khâu phẫu thuật 5-0", "Phẫu thuật", "hộp", 2, 6, 580000, true, "NCC-HUFRIEDY"],
  ["SURG-BLADE-15C", "Lưỡi dao phẫu thuật 15C", "Phẫu thuật", "hộp", 3, 12, 180000, false, "NCC-HUFRIEDY"],
  ["IMPLANT-DRAPE", "Bộ phủ phẫu thuật implant", "Phẫu thuật", "bộ", 4, 8, 380000, true, "NCC-HUFRIEDY"],
  ["BONE-GRAFT-05", "Xương ghép 0.5g", "Implant", "lọ", 2, 8, 1850000, true, "NCC-STRAUMANN"],
  ["MEMBRANE-COLLAGEN", "Màng collagen", "Implant", "miếng", 2, 8, 2100000, true, "NCC-STRAUMANN"],
  ["SURG-GUIDE-SLEEVE", "Sleeve máng hướng dẫn implant", "Implant", "bộ", 2, 6, 650000, true, "NCC-STRAUMANN"],
  ["ORTHO-BRACKET", "Bộ mắc cài kim loại", "Chỉnh nha", "bộ", 3, 10, 1850000, false, "NCC-ORTHO"],
  ["ORTHO-WIRE", "Dây cung chỉnh nha", "Chỉnh nha", "bộ", 6, 20, 320000, false, "NCC-ORTHO"],
  ["ORTHO-ELASTIC", "Thun chỉnh nha", "Chỉnh nha", "gói", 8, 30, 65000, false, "NCC-ORTHO"],
  ["ALIGNER-ATTACH", "Composite attachment khay trong", "Chỉnh nha", "bộ", 3, 10, 450000, true, "NCC-ORTHO"],
  ["SCAN", "Lượt scan trong miệng", "Kỹ thuật số", "lần", 0, 0, 0, false, "NCC-EQUIP"],
];

const assets = [
  ["EQ-CHAIR-01", "Ghế nha khoa 1", "Ghế điều trị", "CHAIR-2024-001", 180000000, "ACTIVE"],
  ["EQ-CHAIR-02", "Ghế nha khoa 2", "Ghế điều trị", "CHAIR-2024-002", 180000000, "ACTIVE"],
  ["EQ-AUTOCLAVE", "Nồi hấp tiệt trùng 23L", "Vô trùng", "AUTO-23L-045", 125000000, "ACTIVE"],
  ["EQ-COMPRESSOR", "Máy nén khí không dầu", "Hạ tầng khí", "CMP-2023-018", 85000000, "ACTIVE"],
  ["EQ-SUCTION", "Máy hút trung tâm", "Hạ tầng hút", "SUC-2023-011", 92000000, "ACTIVE"],
  ["EQ-XRAY", "Máy X-quang quanh chóp", "Chẩn đoán hình ảnh", "XR-PA-009", 98000000, "ACTIVE"],
  ["EQ-CBCT", "Máy CBCT", "Chẩn đoán hình ảnh", "CBCT-2024-002", 1450000000, "ACTIVE"],
  ["EQ-SCANNER", "Máy scan trong miệng", "Kỹ thuật số", "IOS-2024-015", 520000000, "ACTIVE"],
  ["EQ-ENDO-MOTOR", "Máy motor nội nha", "Nội nha", "ENDO-2024-006", 32000000, "ACTIVE"],
  ["EQ-APEX", "Máy định vị chóp", "Nội nha", "APEX-2024-004", 24000000, "ACTIVE"],
];

const formTemplates = [
  ["CONSENT-TX", "CONSENT", "Đồng ý điều trị tổng quát", "1.0", true, [
    "Tôi xác nhận đã được giải thích về tình trạng răng miệng, chẩn đoán, mục tiêu điều trị, phương án thay thế, lợi ích, rủi ro có thể gặp, chi phí dự kiến và lịch tái khám.",
    "Tôi hiểu kết quả điều trị phụ thuộc tình trạng mô/răng/xương, tuân thủ chăm sóc tại nhà và việc tái khám đúng hẹn.",
    "Tôi đồng ý cho phòng khám thực hiện các bước điều trị đã được thống nhất trong kế hoạch.",
  ]],
  ["MED-HX", "MEDICAL_HISTORY", "Khai báo tiền sử y khoa", "1.0", true, [
    "Bệnh nhân khai báo dị ứng thuốc/thức ăn/vật liệu nha khoa, bệnh toàn thân, thuốc đang dùng, tiền sử phẫu thuật, tình trạng thai kỳ và các yếu tố nguy cơ liên quan điều trị nha khoa.",
    "Bệnh nhân cam kết cập nhật ngay nếu có thay đổi về sức khỏe hoặc thuốc đang sử dụng.",
  ]],
  ["FIN-POL", "FINANCIAL_POLICY", "Xác nhận chính sách tài chính", "1.0", true, [
    "Bệnh nhân xác nhận đã hiểu báo giá, khoản cọc, lịch thanh toán, phần đã thu, phần còn lại, chính sách hoàn/hủy và quy định xuất hóa đơn.",
    "Các phát sinh ngoài kế hoạch ban đầu cần được xác nhận trước khi thực hiện.",
  ]],
  ["CONSENT-SURGERY", "CONSENT", "Đồng ý phẫu thuật nha khoa", "1.0", true, [
    "Tôi đã được giải thích về chỉ định phẫu thuật, gây tê, chảy máu, sưng đau, nhiễm trùng, khô ổ răng, tê bì, tổn thương mô lân cận và các biến chứng hiếm gặp.",
    "Tôi đồng ý tuân thủ hướng dẫn dùng thuốc, chườm lạnh, ăn uống, vệ sinh và tái khám sau phẫu thuật.",
  ]],
  ["CONSENT-IMPLANT", "CONSENT", "Đồng ý cấy ghép implant", "1.0", true, [
    "Tôi đã được giải thích về kế hoạch implant, phim/chẩn đoán hình ảnh, ghép xương/nâng xoang nếu cần, thời gian tích hợp xương, phục hình sau implant và khả năng thất bại implant.",
    "Tôi hiểu hút thuốc, bệnh toàn thân, vệ sinh răng miệng và tái khám ảnh hưởng trực tiếp đến tiên lượng implant.",
  ]],
  ["CONSENT-ENDO", "CONSENT", "Đồng ý điều trị tủy", "1.0", true, [
    "Tôi đã được giải thích về mục tiêu bảo tồn răng, số lần hẹn, nguy cơ đau sau điều trị, gãy dụng cụ, thủng chân răng, tái nhiễm và nhu cầu phục hồi thân răng sau điều trị tủy.",
  ]],
  ["CONSENT-ORTHO", "CONSENT", "Đồng ý chỉnh nha", "1.0", true, [
    "Tôi đã được giải thích về mục tiêu chỉnh nha, thời gian dự kiến, nhổ răng/mini vít nếu cần, nguy cơ tiêu chân răng, sâu răng, viêm nướu, tái phát và yêu cầu đeo hàm duy trì.",
  ]],
  ["CONSENT-WHITEN", "CONSENT", "Đồng ý tẩy trắng răng", "1.0", true, [
    "Tôi đã được giải thích về ê buốt, kích ứng nướu, giới hạn màu răng có thể đạt được và việc miếng trám/mão/veneer không đổi màu theo răng thật.",
  ]],
  ["POST-EXTRACTION", "POST_OP", "Dặn dò sau nhổ răng/phẫu thuật", "1.0", false, [
    "Cắn gạc 30-45 phút. Không súc miệng mạnh, không khạc nhổ, không dùng ống hút trong 24 giờ đầu.",
    "Ăn mềm, tránh đồ nóng/cay/rượu bia. Uống thuốc đúng toa. Liên hệ phòng khám nếu chảy máu kéo dài, sốt, đau tăng hoặc sưng bất thường.",
  ]],
  ["POST-ENDO", "POST_OP", "Dặn dò sau điều trị tủy", "1.0", false, [
    "Có thể ê khi nhai trong vài ngày đầu. Tránh nhai mạnh bên răng đang điều trị cho đến khi phục hồi thân răng hoàn chỉnh.",
    "Tái khám đúng hẹn để hoàn tất trám bít/phục hồi và kiểm tra phim.",
  ]],
  ["POST-IMPLANT", "POST_OP", "Dặn dò sau cấy implant", "1.0", false, [
    "Chườm lạnh trong 24 giờ đầu, uống thuốc đúng toa, giữ vùng phẫu thuật sạch, không hút thuốc, không vận động mạnh.",
    "Không tự ý chạm vào vùng implant. Tái khám theo lịch để cắt chỉ và kiểm tra lành thương.",
  ]],
  ["INTAKE-NEW", "INTAKE", "Phiếu tiếp nhận bệnh nhân mới", "1.0", false, [
    "Ghi nhận thông tin hành chính, lý do đến khám, nguồn khách, mong muốn điều trị, tiền sử nha khoa và kênh liên hệ ưu tiên.",
  ]],
  ["PRIVACY-DATA", "CUSTOM", "Đồng ý xử lý dữ liệu và hình ảnh", "1.0", true, [
    "Bệnh nhân đồng ý để phòng khám lưu trữ hồ sơ điều trị, hình ảnh lâm sàng, phim chụp và tài liệu liên quan phục vụ điều trị, chăm sóc sau điều trị và nghĩa vụ lưu trữ hồ sơ.",
  ]],
  ["LAB-RX", "CUSTOM", "Phiếu gửi labo", "1.0", false, [
    "Thông tin phục hình: răng/vùng, loại vật liệu, màu răng, hình dạng, khớp cắn, ngày hẹn thử, ngày giao, ghi chú labo và người phụ trách.",
  ]],
];

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function schemaForTemplate(code) {
  const common = [
    { id: "patientNote", label: "Ghi chú của bệnh nhân", type: "textarea", required: false },
    { id: "staffReview", label: "Nhân sự đã kiểm tra", type: "checkbox", required: false },
  ];

  if (code === "MED-HX") {
    return {
      fields: [
        { id: "allergies", label: "Dị ứng", type: "textarea", required: false },
        { id: "medications", label: "Thuốc đang dùng", type: "textarea", required: false },
        { id: "conditions", label: "Bệnh toàn thân", type: "textarea", required: false },
        ...common,
      ],
    };
  }

  if (code === "INTAKE-NEW") {
    return {
      fields: [
        { id: "chiefComplaint", label: "Lý do đến khám", type: "textarea", required: true },
        { id: "leadSource", label: "Nguồn khách", type: "text", required: true },
        { id: "expectation", label: "Mong muốn điều trị", type: "textarea", required: false },
        ...common,
      ],
    };
  }

  return { fields: common };
}

function bodyFromParagraphs(paragraphs) {
  return paragraphs.map((line, index) => `${index + 1}. ${line}`).join("\n\n");
}

function repairVietnameseText(value) {
  if (typeof value !== "string") return value;
  if (!/[\u00c3\u00c4\u00c6]|\u00e1[\u00ba\u00bb]/.test(value)) return value;
  return Buffer.from(value, "latin1").toString("utf8");
}

async function main() {
  const organizations = await prisma.organization.findMany({
    include: {
      clinics: { where: { active: true }, orderBy: { createdAt: "asc" } },
      users: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  if (organizations.length === 0) {
    throw new Error("No organization found. Create an organization first.");
  }

  for (const organization of organizations) {
    const actorId = organization.users[0]?.id ?? null;
    const clinics = organization.clinics;
    await seedOrganization(organization.id, clinics, actorId);
  }

  await syncFullServiceCatalogAcrossOrganizations(organizations.map((organization) => organization.id));
  await repairExistingSeedText();

  const summary = await Promise.all(
    organizations.map(async (organization) => ({
      organization: organization.name,
      services: await prisma.serviceCatalogItem.count({ where: { organizationId: organization.id, status: "ACTIVE" } }),
      formTemplates: await prisma.formTemplate.count({ where: { organizationId: organization.id, active: true } }),
      inventoryItems: await prisma.inventoryItem.count({ where: { organizationId: organization.id, active: true } }),
      suppliers: await prisma.inventorySupplier.count({ where: { organizationId: organization.id, active: true } }),
      assets: await prisma.equipmentAsset.count({ where: { organizationId: organization.id } }),
    })),
  );

  console.table(summary);
}

async function syncFullServiceCatalogAcrossOrganizations(organizationIds) {
  const serviceCounts = await Promise.all(
    organizationIds.map(async (organizationId) => ({
      organizationId,
      count: await prisma.serviceCatalogItem.count({ where: { organizationId } }),
    })),
  );
  const sourceOrganizationId = serviceCounts.sort((a, b) => b.count - a.count)[0]?.organizationId;
  if (!sourceOrganizationId) return;

  const sourceServices = await prisma.serviceCatalogItem.findMany({
    where: { organizationId: sourceOrganizationId },
    include: {
      category: { select: { code: true } },
      steps: { orderBy: { sequence: "asc" } },
      materials: true,
      prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 },
    },
    orderBy: { code: "asc" },
  });

  for (const organizationId of organizationIds) {
    if (organizationId === sourceOrganizationId) continue;

    const categories = await prisma.serviceCategory.findMany({
      where: { organizationId },
      select: { id: true, code: true },
    });
    const categoryMap = new Map(categories.map((category) => [category.code, category.id]));
    const items = await prisma.inventoryItem.findMany({
      where: { organizationId },
      select: { id: true, code: true },
    });
    const itemMap = new Map(items.map((item) => [item.code, item.id]));

    for (const source of sourceServices) {
      const price = Number(source.prices[0]?.price ?? source.defaultPrice ?? 0);
      const target = await prisma.serviceCatalogItem.upsert({
        where: { organizationId_code: { organizationId, code: source.code } },
        update: {
          categoryId: categoryMap.get(source.category?.code ?? "") ?? null,
          name: repairVietnameseText(source.name),
          nameEn: repairVietnameseText(source.nameEn),
          description: repairVietnameseText(source.description),
          defaultPrice: price,
          defaultDurationMinutes: source.defaultDurationMinutes,
          targetMode: source.targetMode,
          billable: source.billable,
          taxable: source.taxable,
          consentRequired: source.consentRequired,
          clinicalTemplate: repairVietnameseText(source.clinicalTemplate),
          version: seedVersion,
          status: "ACTIVE",
        },
        create: {
          organizationId,
          categoryId: categoryMap.get(source.category?.code ?? "") ?? null,
          code: source.code,
          name: repairVietnameseText(source.name),
          nameEn: repairVietnameseText(source.nameEn),
          description: repairVietnameseText(source.description),
          defaultPrice: price,
          defaultDurationMinutes: source.defaultDurationMinutes,
          targetMode: source.targetMode,
          billable: source.billable,
          taxable: source.taxable,
          consentRequired: source.consentRequired,
          clinicalTemplate: repairVietnameseText(source.clinicalTemplate),
          version: seedVersion,
          status: "ACTIVE",
        },
      });

      const activePrice = await prisma.servicePrice.findFirst({
        where: { organizationId, serviceId: target.id, clinicId: null, active: true },
        select: { id: true },
      });
      if (!activePrice) {
        await prisma.servicePrice.create({
          data: {
            organizationId,
            serviceId: target.id,
            price,
            currency: "VND",
            version: seedVersion,
            active: true,
            note: "Giá mẫu phục vụ pilot",
          },
        });
      }

      for (const step of source.steps) {
        await prisma.serviceStep.upsert({
          where: { serviceId_sequence: { serviceId: target.id, sequence: step.sequence } },
          update: {
            name: repairVietnameseText(step.name),
            description: repairVietnameseText(step.description),
            expectedMinutes: step.expectedMinutes,
            defaultProgress: step.defaultProgress,
            roleHint: repairVietnameseText(step.roleHint),
            required: step.required,
          },
          create: {
            organizationId,
            serviceId: target.id,
            sequence: step.sequence,
            name: repairVietnameseText(step.name),
            description: repairVietnameseText(step.description),
            expectedMinutes: step.expectedMinutes,
            defaultProgress: step.defaultProgress,
            roleHint: repairVietnameseText(step.roleHint),
            required: step.required,
          },
        });
      }

      for (const material of source.materials) {
        const itemCode = material.itemCode ?? null;
        const existing = await prisma.serviceMaterial.findFirst({
          where: {
            organizationId,
            serviceId: target.id,
            itemCode,
            name: repairVietnameseText(material.name),
          },
          select: { id: true },
        });
        const data = {
          inventoryItemId: itemCode ? itemMap.get(itemCode) ?? null : null,
          itemCode,
          name: repairVietnameseText(material.name),
          quantity: material.quantity,
          unit: repairVietnameseText(material.unit),
          required: material.required,
          note: repairVietnameseText(material.note),
        };
        if (existing) {
          await prisma.serviceMaterial.update({ where: { id: existing.id }, data });
        } else {
          await prisma.serviceMaterial.create({ data: { organizationId, serviceId: target.id, ...data } });
        }
      }
    }
  }
}

async function seedOrganization(organizationId, clinics, actorId) {
  const categoryMap = await ensureCategories(organizationId);
  const supplierMap = await ensureSuppliers(organizationId);
  const itemMap = await ensureInventory(organizationId, supplierMap);
  await ensureServices(organizationId, categoryMap);
  await ensureServiceMaterials(organizationId, itemMap);
  await ensureForms(organizationId, actorId);
  await ensureAssets(organizationId, clinics);
  await ensurePurchaseOrders(organizationId, clinics, supplierMap, itemMap);
}

async function ensureCategories(organizationId) {
  const map = new Map();
  for (const [code, name, nameEn, sortOrder] of serviceCategories) {
    const category = await prisma.serviceCategory.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: { name, nameEn, sortOrder, active: true },
      create: { organizationId, code, name, nameEn, sortOrder, active: true },
    });
    map.set(code, category.id);
  }
  return map;
}

async function ensureServices(organizationId, categoryMap) {
  for (const [code, categoryCode, name, nameEn, price, duration, targetMode, consentRequired] of supplementalServices) {
    const service = await prisma.serviceCatalogItem.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: {
        categoryId: categoryMap.get(categoryCode) ?? null,
        name,
        nameEn,
        defaultPrice: price,
        defaultDurationMinutes: duration,
        targetMode,
        consentRequired,
        status: "ACTIVE",
        version: seedVersion,
      },
      create: {
        organizationId,
        categoryId: categoryMap.get(categoryCode) ?? null,
        code,
        name,
        nameEn,
        defaultPrice: price,
        defaultDurationMinutes: duration,
        targetMode,
        consentRequired,
        status: "ACTIVE",
        version: seedVersion,
      },
    });

    await prisma.servicePrice.createMany({
      data: [{
        organizationId,
        serviceId: service.id,
        price,
        currency: "VND",
        active: true,
        version: seedVersion,
        note: "Giá mẫu phục vụ pilot",
      }],
      skipDuplicates: true,
    });

    await ensureStandardSteps(organizationId, service.id);
  }
}

async function ensureStandardSteps(organizationId, serviceId) {
  const steps = [
    [1, "Tư vấn và xác nhận chỉ định", 20, 15],
    [2, "Chuẩn bị hồ sơ, vật tư và khu vực điều trị", 35, 10],
    [3, "Thực hiện điều trị", 75, 45],
    [4, "Kiểm tra, dặn dò và đặt lịch tái khám", 100, 15],
  ];

  for (const [sequence, name, defaultProgress, expectedMinutes] of steps) {
    await prisma.serviceStep.upsert({
      where: { serviceId_sequence: { serviceId, sequence } },
      update: { name, defaultProgress, expectedMinutes, required: true },
      create: { organizationId, serviceId, sequence, name, defaultProgress, expectedMinutes, required: true },
    });
  }
}

async function ensureSuppliers(organizationId) {
  const map = new Map();
  for (const [code, name, phone, email, address] of suppliers) {
    const supplier = await prisma.inventorySupplier.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: { name, phone, email, address, active: true },
      create: { organizationId, code, name, phone, email, address, active: true },
    });
    map.set(code, supplier.id);
  }
  return map;
}

async function ensureInventory(organizationId, supplierMap) {
  const map = new Map();
  for (const [code, name, category, unit, minimumStock, onHandQuantity, averageUnitCost, lotTracked, supplierCode] of inventoryItems) {
    const item = await prisma.inventoryItem.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: {
        supplierId: supplierMap.get(supplierCode) ?? null,
        name,
        category,
        unit,
        minimumStock,
        onHandQuantity,
        averageUnitCost,
        lotTracked,
        active: true,
      },
      create: {
        organizationId,
        supplierId: supplierMap.get(supplierCode) ?? null,
        code,
        sku: code,
        name,
        category,
        unit,
        minimumStock,
        onHandQuantity,
        averageUnitCost,
        lotTracked,
        active: true,
      },
    });
    map.set(code, item.id);

    if (lotTracked && onHandQuantity > 0) {
      await prisma.inventoryLot.upsert({
        where: { itemId_lotNo: { itemId: item.id, lotNo: `${code}-PILOT-01` } },
        update: { quantityOnHand: Math.ceil(onHandQuantity * 0.55), expiresAt: daysFromNow(365) },
        create: {
          organizationId,
          itemId: item.id,
          lotNo: `${code}-PILOT-01`,
          quantityOnHand: Math.ceil(onHandQuantity * 0.55),
          receivedAt: daysFromNow(-30),
          expiresAt: daysFromNow(365),
        },
      });
      await prisma.inventoryLot.upsert({
        where: { itemId_lotNo: { itemId: item.id, lotNo: `${code}-PILOT-02` } },
        update: { quantityOnHand: Math.floor(onHandQuantity * 0.45), expiresAt: daysFromNow(540) },
        create: {
          organizationId,
          itemId: item.id,
          lotNo: `${code}-PILOT-02`,
          quantityOnHand: Math.floor(onHandQuantity * 0.45),
          receivedAt: daysFromNow(-10),
          expiresAt: daysFromNow(540),
        },
      });
    }
  }
  return map;
}

async function ensureServiceMaterials(organizationId, itemMap) {
  for (const [serviceCode, materials] of Object.entries(serviceMaterialMap)) {
    const service = await prisma.serviceCatalogItem.findUnique({
      where: { organizationId_code: { organizationId, code: serviceCode } },
      select: { id: true },
    });
    if (!service) continue;

    for (const [itemCode, quantity, unit] of materials) {
      const inventoryItemId = itemMap.get(itemCode) ?? null;
      const item = inventoryItems.find(([code]) => code === itemCode);
      const name = item?.[1] ?? itemCode;
      const existing = await prisma.serviceMaterial.findFirst({
        where: { organizationId, serviceId: service.id, itemCode },
        select: { id: true },
      });
      if (existing) {
        await prisma.serviceMaterial.update({
          where: { id: existing.id },
          data: { inventoryItemId, name, quantity, unit, required: true, note: "Định mức vật tư mẫu" },
        });
      } else {
        await prisma.serviceMaterial.create({
          data: { organizationId, serviceId: service.id, inventoryItemId, itemCode, name, quantity, unit, required: true, note: "Định mức vật tư mẫu" },
        });
      }
    }
  }
}

async function ensureForms(organizationId, actorId) {
  for (const [code, type, name, version, requiresSignature, paragraphs] of formTemplates) {
    await prisma.formTemplate.upsert({
      where: { organizationId_code_version: { organizationId, code, version } },
      update: {
        type,
        name,
        body: bodyFromParagraphs(paragraphs),
        requiresSignature,
        active: true,
        schema: schemaForTemplate(code),
      },
      create: {
        organizationId,
        createdById: actorId,
        type,
        code,
        name,
        version,
        body: bodyFromParagraphs(paragraphs),
        requiresSignature,
        active: true,
        schema: schemaForTemplate(code),
      },
    });
  }
}

async function ensureAssets(organizationId, clinics) {
  const clinicId = clinics[0]?.id ?? null;
  for (const [code, name, category, serialNo, cost, status] of assets) {
    const asset = await prisma.equipmentAsset.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: { clinicId, name, category, serialNo, cost, status },
      create: {
        organizationId,
        clinicId,
        code,
        name,
        category,
        serialNo,
        purchasedAt: daysFromNow(-420),
        cost,
        warrantyEndsAt: daysFromNow(520),
        status,
      },
    });
    const taskId = `ops-maint-${organizationId}-${code}`.slice(0, 96);
    await prisma.maintenanceTask.upsert({
      where: { id: taskId },
      update: {
        clinicId,
        title: `Bảo trì định kỳ ${name}`,
        dueAt: daysFromNow(code.includes("AUTOCLAVE") ? 7 : 30),
        completedAt: null,
        notes: "Kiểm tra vận hành, vệ sinh, thay vật tư hao mòn và ghi nhận biên bản.",
      },
      create: {
        id: taskId,
        organizationId,
        clinicId,
        assetId: asset.id,
        title: `Bảo trì định kỳ ${name}`,
        dueAt: daysFromNow(code.includes("AUTOCLAVE") ? 7 : 30),
        notes: "Kiểm tra vận hành, vệ sinh, thay vật tư hao mòn và ghi nhận biên bản.",
      },
    });
  }
}

async function ensurePurchaseOrders(organizationId, clinics, supplierMap, itemMap) {
  const clinicId = clinics[0]?.id ?? null;
  const supplierId = supplierMap.get("NCC-GENERAL") ?? [...supplierMap.values()][0];
  if (!supplierId) return;

  const po = await prisma.purchaseOrder.upsert({
    where: { organizationId_poNo: { organizationId, poNo: `PO-${seedVersion}` } },
    update: {
      clinicId,
      supplierId,
      status: "PARTIAL",
      orderedAt: daysFromNow(-5),
      expectedAt: daysFromNow(3),
      totalAmount: 0,
    },
    create: {
      organizationId,
      clinicId,
      supplierId,
      poNo: `PO-${seedVersion}`,
      status: "PARTIAL",
      orderedAt: daysFromNow(-5),
      expectedAt: daysFromNow(3),
      totalAmount: 0,
    },
  });

  const orderLines = [
    ["GANG-NITRILE-M", 20, 95000, 8],
    ["MASK-3L", 30, 42000, 10],
    ["ANES-LIDO-EPI", 100, 8500, 40],
    ["GAUZE-STERILE", 20, 62000, 6],
  ];
  let total = 0;
  for (const [code, quantity, unitCost, receivedQuantity] of orderLines) {
    const itemId = itemMap.get(code);
    if (!itemId) continue;
    total += quantity * unitCost;
    await prisma.purchaseOrderLine.upsert({
      where: { purchaseOrderId_itemId: { purchaseOrderId: po.id, itemId } },
      update: { quantity, unitCost, receivedQuantity },
      create: { purchaseOrderId: po.id, itemId, quantity, unitCost, receivedQuantity },
    });
  }
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { totalAmount: total } });
}

async function repairExistingSeedText() {
  const repairs = [
    [prisma.serviceCategory, ["name", "nameEn", "description"]],
    [prisma.serviceCatalogItem, ["name", "nameEn", "description", "clinicalTemplate", "version"]],
    [prisma.serviceStep, ["name", "description", "roleHint"]],
    [prisma.serviceMaterial, ["name", "unit", "note"]],
    [prisma.inventorySupplier, ["name", "address"]],
    [prisma.inventoryItem, ["name", "category", "unit"]],
    [prisma.inventoryLot, ["lotNo"]],
    [prisma.equipmentAsset, ["name", "category"]],
    [prisma.maintenanceTask, ["title", "notes"]],
    [prisma.formTemplate, ["name", "body"]],
  ];

  for (const [model, fields] of repairs) {
    const rows = await model.findMany({ select: Object.fromEntries(["id", ...fields].map((field) => [field, true])) });
    for (const row of rows) {
      const data = {};
      for (const field of fields) {
        const next = repairVietnameseText(row[field]);
        if (next !== row[field]) data[field] = next;
      }
      if (Object.keys(data).length > 0) {
        await model.update({ where: { id: row.id }, data });
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
