import "server-only";

import { Buffer } from "node:buffer";
import { nextDocumentNo } from "@/lib/document-sequence";
import { defaultDataSeedEnabled } from "@/lib/env";
import { patientAccessWhere } from "@/lib/patient-access";
import { canUseAllClinics, hasAnyRole, type AppRole, type RoleSource } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  MedicationCatalogSummary,
  PharmacyWorkspace,
  PrescriptionSummary,
  PrescriptionTemplateSummary,
  PrintablePrescription,
  PrintablePrescriptionTemplate,
} from "@/lib/pharmacy-types";
import type { AppSession } from "@/lib/session";

const mutablePharmacyRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
];

const defaultMedications = [
  {
    code: "PARA500",
    genericName: "Paracetamol",
    brandName: "Efferalgan",
    strength: "500mg",
    form: "Viên nén/viên sủi",
    defaultSig: "Uống 1 viên mỗi 6 giờ khi đau hoặc sốt.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 6 giờ khi cần",
    warnings: ["Không vượt quá tổng liều paracetamol trong ngày", "Thận trọng bệnh gan hoặc uống rượu nhiều"],
  },
  {
    code: "IBU400",
    genericName: "Ibuprofen",
    brandName: "Brufen",
    strength: "400mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên sau ăn mỗi 8 giờ khi đau.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8 giờ khi cần",
    warnings: ["Tránh dùng khi loét dạ dày, bệnh thận nặng, dị ứng NSAID", "Thận trọng phụ nữ có thai"],
  },
  {
    code: "PARA-IBU",
    genericName: "Paracetamol + Ibuprofen",
    brandName: "Alaxan",
    strength: "325mg + 200mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên sau ăn mỗi 8 giờ khi đau.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8 giờ khi cần",
    warnings: ["Không dùng kèm thuốc khác có paracetamol/NSAID nếu chưa kiểm tra", "Thận trọng bệnh gan, dạ dày, thận"],
  },
  {
    code: "DICLO50",
    genericName: "Diclofenac kali",
    brandName: "Cataflam",
    strength: "50mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên sau ăn mỗi 8-12 giờ khi đau.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8-12 giờ khi cần",
    warnings: ["Tránh dùng khi loét dạ dày, bệnh thận nặng, dị ứng NSAID", "Không phối hợp nhiều NSAID cùng lúc"],
  },
  {
    code: "CELE200",
    genericName: "Celecoxib",
    brandName: "Celebrex",
    strength: "200mg",
    form: "Viên nang",
    defaultSig: "Uống 1 viên sau ăn mỗi ngày hoặc theo chỉ định.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Thận trọng bệnh tim mạch, thận và dị ứng sulfonamide", "Không phối hợp nhiều NSAID cùng lúc"],
  },
  {
    code: "AMOX500",
    genericName: "Amoxicillin",
    brandName: null,
    strength: "500mg",
    form: "Viên nang",
    defaultSig: "Uống 1 viên mỗi 8 giờ sau ăn.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8 giờ",
    warnings: ["Kiểm tra dị ứng penicillin/beta-lactam", "Chỉ dùng kháng sinh khi có chỉ định"],
  },
  {
    code: "AUG625",
    genericName: "Amoxicillin + Acid clavulanic",
    brandName: "Augmentin",
    strength: "625mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi 8 giờ sau ăn.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8 giờ",
    warnings: ["Kiểm tra dị ứng penicillin/beta-lactam", "Chỉ dùng kháng sinh khi có chỉ định"],
  },
  {
    code: "METRO250",
    genericName: "Metronidazole",
    brandName: null,
    strength: "250mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi 8 giờ sau ăn.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8 giờ",
    warnings: ["Tránh rượu trong thời gian dùng thuốc", "Thận trọng bệnh gan và tương tác thuốc"],
  },
  {
    code: "CLIN300",
    genericName: "Clindamycin",
    brandName: null,
    strength: "300mg",
    form: "Viên nang",
    defaultSig: "Uống 1 viên mỗi 8 giờ sau ăn.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 8 giờ",
    warnings: ["Hỏi tiền sử viêm đại tràng/tiêu chảy do kháng sinh", "Chỉ dùng khi có chỉ định phù hợp"],
  },
  {
    code: "CEPHA500",
    genericName: "Cephalexin",
    brandName: null,
    strength: "500mg",
    form: "Viên nang",
    defaultSig: "Uống 1 viên mỗi 6-8 giờ sau ăn.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 6-8 giờ",
    warnings: ["Kiểm tra dị ứng cephalosporin/beta-lactam", "Chỉ dùng kháng sinh khi có chỉ định"],
  },
  {
    code: "AZI500",
    genericName: "Azithromycin",
    brandName: "Zithromax",
    strength: "500mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi ngày.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Thận trọng kéo dài QT, bệnh gan và tương tác thuốc", "Chỉ dùng kháng sinh khi có chỉ định"],
  },
  {
    code: "RODOGYL",
    genericName: "Spiramycin + Metronidazole",
    brandName: "Rodogyl",
    strength: "750.000IU + 125mg",
    form: "Viên nén",
    defaultSig: "Uống theo chỉ định của bác sĩ sau ăn.",
    defaultDose: "Theo chỉ định",
    route: "Uống",
    frequency: "Theo chỉ định",
    warnings: ["Tránh rượu do có metronidazole", "Kiểm tra tương tác thuốc và chống chỉ định"],
  },
  {
    code: "CHX012",
    genericName: "Chlorhexidine",
    brandName: "Kin Gingival",
    strength: "0.12%",
    form: "Nước súc miệng",
    defaultSig: "Súc miệng 15ml trong 30 giây, ngày 2 lần.",
    defaultDose: "15ml",
    route: "Súc miệng",
    frequency: "Ngày 2 lần",
    warnings: ["Không nuốt", "Có thể làm đổi màu răng/lưỡi tạm thời"],
  },
  {
    code: "POVI10",
    genericName: "Povidone-iodine",
    brandName: "Betadine",
    strength: "1%",
    form: "Dung dịch súc miệng",
    defaultSig: "Pha/dùng theo hướng dẫn, súc miệng 2-4 lần/ngày.",
    defaultDose: "Theo hướng dẫn",
    route: "Súc miệng",
    frequency: "2-4 lần/ngày",
    warnings: ["Không nuốt", "Thận trọng bệnh tuyến giáp hoặc dị ứng iodine"],
  },
  {
    code: "OMEP20",
    genericName: "Omeprazole",
    brandName: null,
    strength: "20mg",
    form: "Viên nang",
    defaultSig: "Uống 1 viên trước ăn sáng.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Dùng khi cần bảo vệ dạ dày theo đánh giá của bác sĩ"],
  },
  {
    code: "TRANEX500",
    genericName: "Tranexamic acid",
    brandName: "Transamin",
    strength: "500mg",
    form: "Viên nén",
    defaultSig: "Uống theo chỉ định khi cần kiểm soát chảy máu.",
    defaultDose: "Theo chỉ định",
    route: "Uống",
    frequency: "Theo chỉ định",
    warnings: ["Thận trọng tiền sử huyết khối", "Cần bác sĩ đánh giá nguy cơ chảy máu/huyết khối"],
  },
  {
    code: "PARA-SYR",
    genericName: "Paracetamol",
    brandName: null,
    strength: "120mg/5ml",
    form: "Siro",
    defaultSig: "Uống theo cân nặng mỗi 6 giờ khi đau hoặc sốt.",
    defaultDose: "Theo cân nặng",
    route: "Uống",
    frequency: "Mỗi 6 giờ khi cần",
    warnings: ["Tính liều theo cân nặng trẻ em", "Không dùng kèm thuốc khác có paracetamol"],
  },
  {
    code: "AMOX-SUSP",
    genericName: "Amoxicillin",
    brandName: null,
    strength: "250mg/5ml",
    form: "Bột pha hỗn dịch uống",
    defaultSig: "Uống theo cân nặng mỗi 8 giờ sau ăn.",
    defaultDose: "Theo cân nặng",
    route: "Uống",
    frequency: "Mỗi 8 giờ",
    warnings: ["Tính liều theo cân nặng trẻ em", "Kiểm tra dị ứng penicillin/beta-lactam"],
  },
  {
    code: "CEFU500",
    genericName: "Cefuroxime axetil",
    brandName: "Zinnat",
    strength: "500mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi 12 giờ sau ăn.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi 12 giờ",
    warnings: ["Kiểm tra dị ứng cephalosporin/beta-lactam", "Chỉ dùng kháng sinh khi có chỉ định"],
  },
  {
    code: "MOXI400",
    genericName: "Moxifloxacin",
    brandName: "Avelox",
    strength: "400mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi ngày theo chỉ định.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Thận trọng kéo dài QT và tương tác thuốc", "Không dùng thường quy khi còn lựa chọn an toàn hơn"],
  },
  {
    code: "MELO7",
    genericName: "Meloxicam",
    brandName: "Mobic",
    strength: "7.5mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên sau ăn mỗi ngày khi đau.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Tránh dùng khi loét dạ dày, bệnh thận nặng, dị ứng NSAID", "Không phối hợp nhiều NSAID cùng lúc"],
  },
  {
    code: "ETORI60",
    genericName: "Etoricoxib",
    brandName: "Arcoxia",
    strength: "60mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên sau ăn mỗi ngày khi đau.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Thận trọng bệnh tim mạch, tăng huyết áp, bệnh thận", "Không phối hợp nhiều NSAID cùng lúc"],
  },
  {
    code: "PRED5",
    genericName: "Prednisolone",
    brandName: null,
    strength: "5mg",
    form: "Viên nén",
    defaultSig: "Uống theo chỉ định sau ăn.",
    defaultDose: "Theo chỉ định",
    route: "Uống",
    frequency: "Theo chỉ định",
    warnings: ["Thận trọng đái tháo đường, tăng huyết áp, loét dạ dày, nhiễm trùng", "Không dùng kéo dài nếu không theo dõi"],
  },
  {
    code: "METHYL16",
    genericName: "Methylprednisolone",
    brandName: "Medrol",
    strength: "16mg",
    form: "Viên nén",
    defaultSig: "Uống theo chỉ định sau ăn.",
    defaultDose: "Theo chỉ định",
    route: "Uống",
    frequency: "Theo chỉ định",
    warnings: ["Thận trọng đái tháo đường, tăng huyết áp, loét dạ dày, nhiễm trùng", "Không dùng kéo dài nếu không theo dõi"],
  },
  {
    code: "CET10",
    genericName: "Cetirizine",
    brandName: null,
    strength: "10mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi ngày khi dị ứng.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Có thể gây buồn ngủ", "Thận trọng suy thận"],
  },
  {
    code: "LORA10",
    genericName: "Loratadine",
    brandName: null,
    strength: "10mg",
    form: "Viên nén",
    defaultSig: "Uống 1 viên mỗi ngày khi dị ứng.",
    defaultDose: "1 viên",
    route: "Uống",
    frequency: "Mỗi ngày",
    warnings: ["Thận trọng bệnh gan nặng", "Không dùng thay thế xử trí phản vệ"],
  },
  {
    code: "ALPHA",
    genericName: "Alpha chymotrypsin",
    brandName: null,
    strength: "4.2mg",
    form: "Viên nén",
    defaultSig: "Uống/ngậm theo chỉ định.",
    defaultDose: "Theo chỉ định",
    route: "Uống/ngậm",
    frequency: "Theo chỉ định",
    warnings: ["Thận trọng rối loạn đông máu hoặc đang dùng thuốc chống đông"],
  },
  {
    code: "NYSTATIN",
    genericName: "Nystatin",
    brandName: null,
    strength: "100.000IU/ml",
    form: "Hỗn dịch uống",
    defaultSig: "Ngậm trong miệng rồi nuốt theo chỉ định.",
    defaultDose: "Theo chỉ định",
    route: "Ngậm/uống",
    frequency: "Theo chỉ định",
    warnings: ["Dùng đúng thời gian được kê", "Đánh giá lại nếu tổn thương không cải thiện"],
  },
  {
    code: "FLUCO150",
    genericName: "Fluconazole",
    brandName: null,
    strength: "150mg",
    form: "Viên nang",
    defaultSig: "Uống theo chỉ định.",
    defaultDose: "Theo chỉ định",
    route: "Uống",
    frequency: "Theo chỉ định",
    warnings: ["Thận trọng bệnh gan, thai kỳ và tương tác thuốc", "Chỉ dùng khi có chỉ định nhiễm nấm phù hợp"],
  },
  {
    code: "LIDO-GEL",
    genericName: "Lidocaine",
    brandName: "Xylocaine",
    strength: "2%",
    form: "Gel bôi niêm mạc",
    defaultSig: "Bôi lượng nhỏ tại vùng đau theo chỉ định.",
    defaultDose: "Lượng nhỏ",
    route: "Bôi niêm mạc",
    frequency: "Theo chỉ định",
    warnings: ["Không bôi quá liều", "Tránh nuốt nhiều, thận trọng trẻ nhỏ"],
  },
  {
    code: "BENZY",
    genericName: "Benzydamine",
    brandName: "Tantum Verde",
    strength: "0.15%",
    form: "Dung dịch súc miệng/xịt họng",
    defaultSig: "Dùng tại chỗ theo hướng dẫn, không nuốt.",
    defaultDose: "Theo hướng dẫn",
    route: "Tại chỗ",
    frequency: "2-3 lần/ngày",
    warnings: ["Không nuốt", "Ngưng dùng nếu kích ứng tăng"],
  },
];

const defaultTemplates = [
  {
    code: "DENT-PAIN",
    name: "Đau răng / sau thủ thuật nhẹ",
    diagnosis: "Đau răng hoặc đau sau thủ thuật nha khoa",
    instructions: "Kiểm tra tiền sử dị ứng, bệnh gan, bệnh dạ dày, bệnh thận và thuốc đang dùng trước khi ký đơn.",
    items: [
      {
        medicationCode: "PARA500",
        sig: "Uống 1 viên mỗi 6 giờ khi đau hoặc sốt.",
        quantity: "12 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Không dùng thêm thuốc khác có paracetamol nếu chưa kiểm tra.",
      },
    ],
  },
  {
    code: "POSTOP",
    name: "Sau nhổ răng / tiểu phẫu thường",
    diagnosis: "Chăm sóc sau nhổ răng hoặc tiểu phẫu nha khoa",
    instructions: "Không dùng kháng sinh thường quy nếu không có chỉ định nhiễm trùng/lan tỏa. Kiểm tra chống chỉ định NSAID.",
    items: [
      {
        medicationCode: "PARA500",
        sig: "Uống 1 viên mỗi 6 giờ khi đau.",
        quantity: "12 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Không vượt quá tổng liều paracetamol trong ngày.",
      },
      {
        medicationCode: "IBU400",
        sig: "Uống 1 viên sau ăn mỗi 8 giờ khi đau.",
        quantity: "9 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Ngưng và báo bác sĩ nếu đau dạ dày, dị ứng hoặc khó thở.",
      },
      {
        medicationCode: "CHX012",
        sig: "Súc miệng 15ml trong 30 giây, ngày 2 lần.",
        quantity: "1 chai",
        refills: 0,
        durationDays: 7,
        instructions: "Bắt đầu sau 24 giờ nếu phù hợp với hướng dẫn hậu phẫu.",
      },
    ],
  },
  {
    code: "ENDO",
    name: "Nội nha có nhiễm trùng",
    diagnosis: "Nhiễm trùng răng / quanh chóp có chỉ định kháng sinh",
    instructions: "Kháng sinh chỉ dùng khi có chỉ định lâm sàng. Kiểm tra dị ứng penicillin/beta-lactam.",
    items: [
      {
        medicationCode: "AUG625",
        sig: "Uống 1 viên mỗi 8 giờ sau ăn.",
        quantity: "21 viên",
        refills: 0,
        durationDays: 7,
        instructions: "Dặn bệnh nhân uống đủ liệu trình nếu đã chỉ định kháng sinh.",
      },
      {
        medicationCode: "IBU400",
        sig: "Uống 1 viên sau ăn mỗi 8 giờ khi đau.",
        quantity: "9 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Tránh nếu có chống chỉ định NSAID.",
      },
    ],
  },
  {
    code: "ABSCESS",
    name: "Áp xe răng / dẫn lưu",
    diagnosis: "Áp xe răng hoặc nhiễm trùng mô mềm vùng miệng",
    instructions: "Ưu tiên xử trí nguyên nhân và dẫn lưu khi có chỉ định. Kiểm tra dị ứng, mức độ lan tỏa và dấu hiệu toàn thân.",
    items: [
      {
        medicationCode: "AUG625",
        sig: "Uống 1 viên mỗi 8 giờ sau ăn.",
        quantity: "21 viên",
        refills: 0,
        durationDays: 7,
        instructions: "Chỉ dùng khi có chỉ định nhiễm trùng.",
      },
      {
        medicationCode: "METRO250",
        sig: "Uống 1 viên mỗi 8 giờ sau ăn.",
        quantity: "21 viên",
        refills: 0,
        durationDays: 7,
        instructions: "Tránh rượu trong thời gian dùng thuốc.",
      },
      {
        medicationCode: "PARA500",
        sig: "Uống 1 viên mỗi 6 giờ khi đau hoặc sốt.",
        quantity: "12 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Không dùng quá tổng liều paracetamol trong ngày.",
      },
    ],
  },
  {
    code: "IMPLANT-POST",
    name: "Sau cấy implant",
    diagnosis: "Chăm sóc sau phẫu thuật implant",
    instructions: "Mẫu cần bác sĩ phẫu thuật duyệt theo mức độ can thiệp, ghép xương/nâng xoang và nguy cơ bệnh nhân.",
    items: [
      {
        medicationCode: "AUG625",
        sig: "Uống 1 viên mỗi 8 giờ sau ăn.",
        quantity: "21 viên",
        refills: 0,
        durationDays: 7,
        instructions: "Kiểm tra dị ứng penicillin/beta-lactam.",
      },
      {
        medicationCode: "PARA-IBU",
        sig: "Uống 1 viên sau ăn mỗi 8 giờ khi đau.",
        quantity: "9 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Không dùng kèm thuốc khác có paracetamol/NSAID nếu chưa kiểm tra.",
      },
      {
        medicationCode: "CHX012",
        sig: "Súc miệng 15ml trong 30 giây, ngày 2 lần.",
        quantity: "1 chai",
        refills: 0,
        durationDays: 10,
        instructions: "Không súc miệng mạnh trong 24 giờ đầu sau phẫu thuật.",
      },
    ],
  },
  {
    code: "PERIO",
    name: "Nha chu / viêm nướu",
    diagnosis: "Viêm nướu hoặc điều trị nha chu hỗ trợ",
    instructions: "Mẫu hỗ trợ sau điều trị cơ học; không thay thế lấy cao răng/nạo túi nha chu.",
    items: [
      {
        medicationCode: "CHX012",
        sig: "Súc miệng 15ml trong 30 giây, ngày 2 lần.",
        quantity: "1 chai",
        refills: 0,
        durationDays: 10,
        instructions: "Dùng sau chải răng, không nuốt.",
      },
      {
        medicationCode: "IBU400",
        sig: "Uống 1 viên sau ăn mỗi 8 giờ khi đau.",
        quantity: "6 viên",
        refills: 0,
        durationDays: 2,
        instructions: "Chỉ dùng nếu đau và không có chống chỉ định NSAID.",
      },
    ],
  },
  {
    code: "PED-PAIN",
    name: "Trẻ em đau răng",
    diagnosis: "Đau răng trẻ em",
    instructions: "Liều trẻ em phải tính theo cân nặng và bác sĩ chịu trách nhiệm chỉnh liều trước khi ký.",
    items: [
      {
        medicationCode: "PARA500",
        sig: "Dùng paracetamol theo cân nặng, mỗi 6 giờ khi đau hoặc sốt.",
        quantity: "Theo cân nặng",
        refills: 0,
        durationDays: 3,
        instructions: "Không dùng liều người lớn cho trẻ nếu chưa tính theo cân nặng.",
      },
    ],
  },
  {
    code: "PED-INFECTION",
    name: "Trẻ em nhiễm trùng răng",
    diagnosis: "Nhiễm trùng răng trẻ em có chỉ định kháng sinh",
    instructions: "Liều trẻ em bắt buộc tính theo cân nặng, tuổi tháng nếu dưới 72 tháng và phải kiểm tra dị ứng.",
    items: [
      {
        medicationCode: "AMOX-SUSP",
        sig: "Uống theo cân nặng mỗi 8 giờ sau ăn.",
        quantity: "Theo cân nặng",
        refills: 0,
        durationDays: 5,
        instructions: "Bác sĩ phải ghi rõ ml/lần sau khi tính liều.",
      },
      {
        medicationCode: "PARA-SYR",
        sig: "Uống theo cân nặng mỗi 6 giờ khi đau hoặc sốt.",
        quantity: "Theo cân nặng",
        refills: 0,
        durationDays: 3,
        instructions: "Không dùng liều người lớn cho trẻ.",
      },
    ],
  },
  {
    code: "PERICORONITIS",
    name: "Viêm quanh thân răng khôn",
    diagnosis: "Viêm quanh thân răng khôn",
    instructions: "Cần đánh giá chỉ định xử trí tại chỗ, dẫn lưu hoặc nhổ răng; thuốc chỉ là hỗ trợ.",
    items: [
      {
        medicationCode: "AUG625",
        sig: "Uống 1 viên mỗi 8 giờ sau ăn.",
        quantity: "15 viên",
        refills: 0,
        durationDays: 5,
        instructions: "Chỉ dùng khi có dấu hiệu nhiễm trùng lan tỏa hoặc chỉ định của bác sĩ.",
      },
      {
        medicationCode: "METRO250",
        sig: "Uống 1 viên mỗi 8 giờ sau ăn.",
        quantity: "15 viên",
        refills: 0,
        durationDays: 5,
        instructions: "Tránh rượu trong thời gian dùng thuốc.",
      },
      {
        medicationCode: "CHX012",
        sig: "Súc miệng 15ml trong 30 giây, ngày 2 lần.",
        quantity: "1 chai",
        refills: 0,
        durationDays: 7,
        instructions: "Không nuốt.",
      },
    ],
  },
  {
    code: "ALLERGY",
    name: "Dị ứng nhẹ vùng miệng",
    diagnosis: "Phản ứng dị ứng nhẹ vùng miệng",
    instructions: "Nếu khó thở, phù môi/lưỡi lan nhanh, tụt huyết áp hoặc phản vệ: chuyển cấp cứu ngay, không xử trí bằng mẫu này.",
    items: [
      {
        medicationCode: "CET10",
        sig: "Uống 1 viên mỗi ngày khi dị ứng.",
        quantity: "3 viên",
        refills: 0,
        durationDays: 3,
        instructions: "Có thể gây buồn ngủ.",
      },
      {
        medicationCode: "PRED5",
        sig: "Uống theo chỉ định sau ăn.",
        quantity: "Theo chỉ định",
        refills: 0,
        durationDays: 3,
        instructions: "Chỉ dùng khi bác sĩ đánh giá cần corticosteroid.",
      },
    ],
  },
  {
    code: "ORAL-FUNGAL",
    name: "Nấm miệng",
    diagnosis: "Nghi nấm miệng",
    instructions: "Đánh giá yếu tố nguy cơ, vệ sinh hàm giả/khí cụ và bệnh nền trước khi kê.",
    items: [
      {
        medicationCode: "NYSTATIN",
        sig: "Ngậm trong miệng rồi nuốt theo chỉ định.",
        quantity: "1 chai",
        refills: 0,
        durationDays: 7,
        instructions: "Dùng đủ liệu trình; tái khám nếu không cải thiện.",
      },
    ],
  },
  {
    code: "ORTHO-ULCER",
    name: "Loét/đau niêm mạc do khí cụ",
    diagnosis: "Loét hoặc kích ứng niêm mạc do khí cụ chỉnh nha/hàm giả",
    instructions: "Phải kiểm tra và chỉnh điểm cấn của khí cụ; thuốc chỉ giảm triệu chứng.",
    items: [
      {
        medicationCode: "BENZY",
        sig: "Dùng tại chỗ theo hướng dẫn, không nuốt.",
        quantity: "1 chai",
        refills: 0,
        durationDays: 5,
        instructions: "Ngưng dùng nếu kích ứng tăng.",
      },
      {
        medicationCode: "LIDO-GEL",
        sig: "Bôi lượng nhỏ tại vùng đau theo chỉ định.",
        quantity: "1 tuýp",
        refills: 0,
        durationDays: 3,
        instructions: "Không bôi quá liều; tránh nuốt nhiều.",
      },
    ],
  },
];
export async function getPharmacyWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<PharmacyWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);

    if (defaultDataSeedEnabled()) {
      await ensurePharmacySeed(session);
    }

    const [patients, medications, templates, prescriptions] = await Promise.all([
      prisma.patient.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { id: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          clinicId: true,
          medicalAlerts: true,
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.medicationCatalogItem.findMany({
        where: {
          organizationId: session.organizationId,
        },
        orderBy: {
          code: "asc",
        },
      }),
      prisma.prescriptionTemplate.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        include: {
          items: {
            orderBy: {
              drugName: "asc",
            },
          },
        },
        orderBy: {
          code: "asc",
        },
      }),
      prisma.prescription.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        include: {
          patient: {
            select: {
              fullName: true,
            },
          },
          prescriber: {
            select: {
              fullName: true,
            },
          },
          items: {
            orderBy: {
              drugName: "asc",
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutablePharmacyRoles),
      message: null,
      patients: patients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        phone: patient.phone,
        clinicId: patient.clinicId,
        medicalAlerts: patient.medicalAlerts,
      })),
      medications: medications.map(toMedicationSummary),
      templates: templates.map(toTemplateSummary),
      prescriptions: prescriptions.map(toPrescriptionSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "pharmacy");
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      patients: [],
      medications: [],
      templates: [],
      prescriptions: [],
    };
  }
}

export async function getPrintablePrescription(
  session: AppSession,
  prescriptionNo: string,
): Promise<PrintablePrescription | null> {
  const prescription = await prisma.prescription.findFirst({
    where: {
      prescriptionNo,
      organizationId: session.organizationId,
      patient: patientAccessWhere(session),
    },
    include: {
      organization: {
        select: {
          name: true,
        },
      },
      clinic: {
        select: {
          name: true,
          city: true,
          address: true,
          phone: true,
        },
      },
      patient: {
        select: {
          fullName: true,
          dateOfBirth: true,
          gender: true,
          nationalId: true,
          guardianName: true,
          phone: true,
          email: true,
          address: true,
        },
      },
      prescriber: {
        select: {
          fullName: true,
        },
      },
      items: {
        orderBy: {
          drugName: "asc",
        },
      },
    },
  });

  if (!prescription) {
    return null;
  }

  return {
    ...toPrescriptionSummary(prescription),
    organizationName: prescription.organization.name,
    clinicName: prescription.clinic.name,
    clinicCity: prescription.clinic.city,
    clinicAddress: prescription.clinic.address,
    clinicPhone: prescription.clinic.phone,
    patientDateOfBirth: prescription.patient.dateOfBirth
      ? vietnamDate(prescription.patient.dateOfBirth)
      : null,
    patientAge: prescription.patient.dateOfBirth
      ? String(ageFromDate(prescription.patient.dateOfBirth))
      : null,
    patientGender: prescription.patient.gender,
    patientNationalId: prescription.patient.nationalId,
    patientGuardianName: prescription.patient.guardianName,
    patientPhone: prescription.patient.phone,
    patientEmail: prescription.patient.email,
    patientAddress: prescription.patient.address,
  };
}

export async function getPrintablePrescriptionTemplate(
  session: AppSession,
  templateId: string,
  patientId?: string | null,
): Promise<PrintablePrescriptionTemplate | null> {
  const clinicIds = allowedClinicIds(session);
  const template = await prisma.prescriptionTemplate.findFirst({
    where: {
      id: templateId,
      organizationId: session.organizationId,
      active: true,
      OR: [
        {
          clinicId: null,
        },
        {
          clinicId: {
            in: clinicIds,
          },
        },
      ],
    },
    include: {
      organization: {
        select: {
          name: true,
        },
      },
      clinic: {
        select: {
          name: true,
          city: true,
          address: true,
          phone: true,
        },
      },
      items: {
        orderBy: {
          drugName: "asc",
        },
      },
    },
  });

  if (!template) {
    return null;
  }

  const patient = patientId
    ? await prisma.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          fullName: true,
          dateOfBirth: true,
          gender: true,
          nationalId: true,
          guardianName: true,
          phone: true,
          address: true,
          clinic: {
            select: {
              name: true,
              city: true,
              address: true,
              phone: true,
            },
          },
        },
      })
    : null;
  const defaultClinic = patient?.clinic ?? template.clinic ?? (await fallbackClinic(session));

  return {
    templateCode: template.code,
    templateName: template.name,
    organizationName: template.organization.name,
    clinicName: defaultClinic?.name ?? "",
    clinicCity: defaultClinic?.city ?? "",
    clinicAddress: defaultClinic?.address ?? "",
    clinicPhone: defaultClinic?.phone ?? "",
    patientName: patient?.fullName ?? "",
    patientDateOfBirth: patient?.dateOfBirth ? vietnamDate(patient.dateOfBirth) : "",
    patientAge: patient?.dateOfBirth ? String(ageFromDate(patient.dateOfBirth)) : "",
    patientGender: patient?.gender ?? "",
    patientNationalId: patient?.nationalId ?? "",
    patientGuardianName: patient?.guardianName ?? "",
    patientPhone: patient?.phone ?? "",
    patientAddress: patient?.address ?? "",
    diagnosis: patient ? template.diagnosis ?? "" : "",
    notes: template.instructions,
    prescriberName: session.fullName,
    createdAt: vietnamDateTime(new Date()),
    items: uniquePrescriptionTemplateItems(template.items).map((item) => ({
      id: item.id,
      drugName: item.drugName,
      sig: mergePrescriptionDirections(item.sig, item.instructions),
      quantity: item.quantity,
      durationDays: item.durationDays,
      instructions: null,
    })),
  };
}

export async function nextPrescriptionNo(organizationId: string) {
  return nextDocumentNo({
    organizationId,
    type: "RX",
    seedCurrentValue: () =>
      prisma.prescription.count({
        where: {
          organizationId,
        },
      }),
  });
}

export function canMutatePharmacy(source: RoleSource) {
  return hasAnyRole(source, mutablePharmacyRoles);
}

export async function ensurePharmacySeed(session: AppSession) {
  const seedMedications = defaultMedications.map(repairSeedRecord);
  const seedTemplates = defaultTemplates.map(repairSeedRecord);

  for (const medication of seedMedications) {
    await prisma.medicationCatalogItem.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code: medication.code,
        },
      },
      update: {
        genericName: medication.genericName,
        brandName: medication.brandName,
        strength: medication.strength,
        form: medication.form,
        defaultSig: medication.defaultSig,
        defaultDose: medication.defaultDose,
        route: medication.route,
        frequency: medication.frequency,
        warnings: medication.warnings,
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        ...medication,
        active: true,
      },
    });
  }

  const medications = await prisma.medicationCatalogItem.findMany({
    where: {
      organizationId: session.organizationId,
    },
    select: {
      id: true,
      code: true,
      genericName: true,
      brandName: true,
      strength: true,
    },
  });
  const medicationByCode = new Map(
    medications.map((medication) => [medication.code, medication]),
  );

  for (const template of seedTemplates) {
    const prescriptionTemplate = await prisma.prescriptionTemplate.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code: template.code,
        },
      },
      update: {
        active: true,
        name: template.name,
        diagnosis: template.diagnosis,
        instructions: template.instructions,
      },
      create: {
        organizationId: session.organizationId,
        createdById: databaseUserId(session.userId),
        code: template.code,
        name: template.name,
        diagnosis: template.diagnosis,
        instructions: template.instructions,
        active: true,
      },
      select: {
        id: true,
      },
    });

    const itemCount = await prisma.prescriptionTemplateItem.count({
      where: {
        templateId: prescriptionTemplate.id,
      },
    });

    if (itemCount > 0) {
      await prisma.prescriptionTemplateItem.deleteMany({
        where: {
          templateId: prescriptionTemplate.id,
        },
      });
    }

    await prisma.prescriptionTemplateItem.createMany({
      data: template.items.map((item) => {
        const medication = medicationByCode.get(item.medicationCode);

        return {
          templateId: prescriptionTemplate.id,
          medicationId: medication?.id ?? null,
          drugName: medication ? displayMedicationName(medication) : item.medicationCode,
          sig: item.sig,
          quantity: item.quantity,
          refills: item.refills,
          durationDays: item.durationDays,
          instructions: item.instructions,
        };
      }),
    });
  }
}

export function displayMedicationName(medication: {
  genericName: string;
  brandName: string | null;
  strength: string | null;
}) {
  const strength = medication.strength ? ` ${medication.strength}` : "";
  const genericName = medication.genericName.trim();
  const brandName = medication.brandName?.trim();
  const isCombination = /[+/]|clavulanic|clavulanate|phối hợp/i.test(genericName);

  if (brandName && isCombination) {
    return `${brandName}${strength}`;
  }

  if (brandName) {
    return `${genericName}${strength} (${brandName})`;
  }

  return `${genericName}${strength}`;
}

function repairSeedRecord<T>(value: T): T {
  if (typeof value === "string") {
    return repairVietnameseSeedText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(repairSeedRecord) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, repairSeedRecord(item)]),
    ) as T;
  }

  return value;
}

function repairVietnameseSeedText(value: string) {
  if (!/[\u00c3\u00c4\u00c6]|\u00e1[\u00ba\u00bb]/.test(value)) {
    return value;
  }

  return Buffer.from(value, "latin1").toString("utf8");
}

function toMedicationSummary(medication: {
  id: string;
  code: string;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  form: string | null;
  defaultSig: string | null;
  defaultDose: string | null;
  route: string | null;
  frequency: string | null;
  warnings: string[];
  active: boolean;
}): MedicationCatalogSummary {
  return medication;
}

function toTemplateSummary(template: {
  id: string;
  code: string;
  name: string;
  diagnosis: string | null;
  instructions: string | null;
  active: boolean;
  items: Array<{
    id: string;
    medicationId: string | null;
    drugName: string;
    sig: string;
    quantity: string | null;
    refills: number;
    durationDays: number | null;
    instructions: string | null;
  }>;
}): PrescriptionTemplateSummary {
  const items = uniquePrescriptionTemplateItems(template.items);

  return {
    ...template,
    items: items.map((item) => ({
      id: item.id,
      medicationId: item.medicationId,
      drugName: item.drugName,
      sig: item.sig,
      quantity: item.quantity,
      refills: item.refills,
      durationDays: item.durationDays,
      instructions: item.instructions,
    })),
  };
}

function uniquePrescriptionTemplateItems<T extends {
  drugName: string;
  medicationId: string | null;
  quantity: string | null;
  sig: string;
  instructions: string | null;
}>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = [
      item.medicationId ?? normalizePharmacyKey(item.drugName),
      normalizePharmacyKey(item.quantity ?? ""),
      normalizePharmacyKey(item.sig),
      normalizePharmacyKey(item.instructions ?? ""),
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizePharmacyKey(value: string) {
  return value.trim().toLowerCase();
}

function toPrescriptionSummary(prescription: {
  id: string;
  prescriptionNo: string;
  patientId: string;
  clinicId: string;
  prescriber: {
    fullName: string;
  };
  patient: {
    fullName: string;
  };
  status: string;
  diagnosis: string | null;
  notes: string | null;
  signedAt: Date | null;
  printedAt: Date | null;
  createdAt: Date;
  items: Array<{
    id: string;
    medicationId: string | null;
    drugName: string;
    strength: string | null;
    sig: string;
    quantity: string | null;
    refills: number;
    durationDays: number | null;
    instructions: string | null;
  }>;
}): PrescriptionSummary {
  return {
    id: prescription.id,
    prescriptionNo: prescription.prescriptionNo,
    patientId: prescription.patientId,
    patientName: prescription.patient.fullName,
    clinicId: prescription.clinicId,
    prescriberName: prescription.prescriber.fullName,
    status: prescription.status as PrescriptionSummary["status"],
    diagnosis: prescription.diagnosis,
    notes: prescription.notes,
    signedAt: prescription.signedAt ? vietnamDateTime(prescription.signedAt) : null,
    signedAtIso: prescription.signedAt?.toISOString() ?? null,
    printedAt: prescription.printedAt ? vietnamDateTime(prescription.printedAt) : null,
    printedAtIso: prescription.printedAt?.toISOString() ?? null,
    createdAt: vietnamDateTime(prescription.createdAt),
    createdAtIso: prescription.createdAt.toISOString(),
    items: prescription.items.map((item) => ({
      id: item.id,
      medicationId: item.medicationId,
      drugName: item.drugName,
      strength: item.strength,
      sig: item.sig,
      quantity: item.quantity,
      refills: item.refills,
      durationDays: item.durationDays,
      instructions: item.instructions,
    })),
  };
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

async function fallbackClinic(session: AppSession) {
  const clinicId = session.activeClinicId ?? session.clinicIds[0];

  if (!clinicId) {
    return null;
  }

  return prisma.clinic.findFirst({
    where: {
      id: clinicId,
      organizationId: session.organizationId,
    },
    select: {
      name: true,
      city: true,
      address: true,
      phone: true,
    },
  });
}

function databaseUserId(userId: string) {
  return userId.startsWith("demo-") ? null : userId;
}

function ageFromDate(dateOfBirth: Date) {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDelta = today.getMonth() - dateOfBirth.getMonth();

  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < dateOfBirth.getDate())
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function mergePrescriptionDirections(sig: string, instructions: string | null) {
  const cleanSig = sig.trim();
  const cleanInstructions = instructions?.trim() ?? "";

  if (!cleanInstructions || cleanSig === cleanInstructions) {
    return cleanSig;
  }

  return `${cleanSig}\n${cleanInstructions}`;
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(value);
}

