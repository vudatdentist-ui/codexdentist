export type DentalServiceCategory =
  | "diagnostics"
  | "preventive"
  | "restorative"
  | "endodontics"
  | "periodontics"
  | "surgery"
  | "prosthodontics"
  | "implant"
  | "orthodontics"
  | "pediatric"
  | "emergency";

export type DentalServiceStepDefinition = {
  sequence: number;
  name: string;
  defaultProgress: number;
  expectedMinutes: number;
  description?: string;
  roleHint?: string;
  required?: boolean;
};

export type DentalServiceCatalogItem = {
  id: string;
  code: string;
  category: DentalServiceCategory;
  name: string;
  nameEn: string;
  price: number;
  defaultDurationMinutes: number;
  targetMode?: "TOOTH" | "TOOTH_OR_GROUP" | "ARCH" | "MOUTH" | "QUADRANT";
  consentRequired?: boolean;
  steps: DentalServiceStepDefinition[];
};

type WorkflowRow = [
  name: string,
  defaultProgress: number,
  expectedMinutes: number,
  description?: string,
  roleHint?: string,
];

const workflow = (rows: WorkflowRow[]): DentalServiceStepDefinition[] =>
  rows.map(([name, defaultProgress, expectedMinutes, description, roleHint], index) => ({
    sequence: index + 1,
    name,
    defaultProgress,
    expectedMinutes,
    description,
    roleHint,
    required: true,
  }));

const examWorkflow = workflow([
  ["Tiếp nhận lý do khám và mong muốn điều trị", 15, 10, "Ghi lý do đến khám, triệu chứng chính, kỳ vọng thẩm mỹ/chức năng và mức độ ưu tiên của bệnh nhân."],
  ["Khai thác tiền sử y khoa và nha khoa", 30, 10, "Rà bệnh nền, thuốc đang dùng, dị ứng, tiền sử điều trị nha khoa và yếu tố nguy cơ."],
  ["Khám ngoài mặt, trong miệng và khớp cắn", 55, 15, "Đánh giá mô mềm, răng, nha chu, khớp cắn, dấu hiệu đau, sưng, lung lay hoặc mất răng."],
  ["Chỉ định phim, ảnh hoặc xét nghiệm bổ sung", 70, 10, "Chọn phim quanh chóp, panorama, CBCT, ảnh trong miệng hoặc test tủy khi cần."],
  ["Tổng hợp chẩn đoán và mức độ ưu tiên", 85, 10, "Phân loại vấn đề cấp cứu, bệnh lý cần xử trí trước và nhu cầu phục hồi/thẩm mỹ."],
  ["Tư vấn kế hoạch, chi phí và bước tiếp theo", 100, 15, "Giải thích lựa chọn điều trị, tiên lượng, thời gian, chi phí dự kiến và lưu hồ sơ."],
]);

const imageWorkflow = workflow([
  ["Xác nhận chỉ định và vùng cần chụp", 20, 3, "Đối chiếu răng/vùng cần khảo sát với hồ sơ và yêu cầu của bác sĩ."],
  ["Chuẩn bị bệnh nhân và bảo hộ tia X", 40, 4, "Tháo vật kim loại nếu cần, đặt tạp dề chì/cổ chì theo quy trình phòng chụp."],
  ["Định vị máy, cảm biến hoặc trường chụp", 60, 4, "Căn chỉnh đầu bệnh nhân, phim/cảm biến và thông số chụp phù hợp."],
  ["Thực hiện chụp", 80, 3, "Chụp đúng chỉ định, hạn chế chụp lại không cần thiết."],
  ["Kiểm tra chất lượng và lưu hồ sơ", 100, 5, "Kiểm tra độ rõ, vùng phủ, lỗi kỹ thuật và đính kèm phim vào bệnh án."],
]);

const cbctWorkflow = workflow([
  ["Xác nhận chỉ định CBCT và phạm vi khảo sát", 15, 5, "Xác định vùng chụp, FOV, mục tiêu: implant, răng khôn, nội nha, phẫu thuật hoặc bệnh lý."],
  ["Sàng lọc chống chỉ định và chuẩn bị bệnh nhân", 30, 5, "Hỏi thai kỳ, tháo vật kim loại, giải thích cách giữ yên trong lúc chụp."],
  ["Định vị bệnh nhân và chọn thông số chụp", 55, 8, "Căn đường giữa, mặt phẳng tham chiếu và thông số phù hợp với vùng khảo sát."],
  ["Thực hiện chụp CBCT", 70, 5, "Theo dõi bệnh nhân trong buồng chụp và đảm bảo dữ liệu thu nhận hoàn chỉnh."],
  ["Dựng dữ liệu, kiểm tra lát cắt và chất lượng ảnh", 90, 10, "Kiểm tra nhiễu, vùng phủ, lát cắt quan trọng và khả năng đọc phim."],
  ["Lưu file, ảnh trích xuất và chuyển bác sĩ đọc phim", 100, 7, "Đính kèm file/ảnh vào hồ sơ, ghi chú vùng cần bác sĩ đánh giá."],
]);

const scalingWorkflow = workflow([
  ["Đánh giá mảng bám, cao răng và tình trạng nướu", 15, 8, "Quan sát chảy máu, viêm nướu, túi nha chu nghi ngờ và vùng cao răng nhiều."],
  ["Lấy cao răng bằng siêu âm", 45, 20, "Loại bỏ cao răng trên nướu và vùng sát viền nướu theo từng vùng hàm."],
  ["Làm sạch kẽ răng và vùng khó tiếp cận", 65, 10, "Dùng dụng cụ tay/chỉ nha khoa/bàn chải kẽ để hoàn thiện các điểm còn sót."],
  ["Đánh bóng bề mặt răng", 85, 10, "Loại bỏ mảng bám màu nhẹ và làm mịn bề mặt sau lấy cao."],
  ["Kiểm tra chảy máu, ê buốt và hướng dẫn chăm sóc", 100, 10, "Dặn vệ sinh tại nhà, lịch tái khám và lưu ý vùng viêm cần theo dõi."],
]);

const polishingWorkflow = workflow([
  ["Đánh giá mảng màu và bề mặt cần đánh bóng", 20, 5],
  ["Làm sạch sơ bộ và cô lập tương đối", 40, 5],
  ["Đánh bóng bằng chổi/cao su và paste phù hợp", 75, 15],
  ["Làm sạch lại, kiểm tra bề mặt và kẽ răng", 90, 5],
  ["Hướng dẫn duy trì màu răng và vệ sinh", 100, 5],
]);

const fluorideWorkflow = workflow([
  ["Đánh giá nguy cơ sâu răng và ê buốt", 20, 5],
  ["Làm sạch và làm khô bề mặt răng", 45, 5],
  ["Bôi fluoride đúng vùng chỉ định", 75, 8],
  ["Kiểm tra phủ đều và loại bỏ phần dư", 90, 3],
  ["Dặn dò ăn uống và chăm sóc sau bôi", 100, 4],
]);

const sealantWorkflow = workflow([
  ["Đánh giá hố rãnh và chỉ định trám bít", 15, 5],
  ["Làm sạch mặt nhai và cô lập", 35, 8],
  ["Xử lý bề mặt men", 55, 5],
  ["Đặt vật liệu trám bít hố rãnh", 75, 8],
  ["Chiếu đèn, kiểm tra khớp cắn và độ kín", 100, 8],
]);

const perioMaintenanceWorkflow = workflow([
  ["Đánh giá chỉ số nha chu và vùng tái viêm", 15, 10],
  ["Lấy cao răng duy trì trên và dưới nướu", 45, 20],
  ["Làm sạch túi nông, kẽ răng và phục hình", 65, 15],
  ["Đánh bóng và kiểm soát mảng bám", 85, 10],
  ["Điều chỉnh hướng dẫn vệ sinh và hẹn duy trì", 100, 10],
]);

const fillingWorkflow = workflow([
  ["Đánh giá xoang sâu, khớp cắn và chọn màu", 15, 8],
  ["Vô cảm và cô lập vùng điều trị", 30, 8],
  ["Loại bỏ mô sâu và tạo xoang bảo tồn", 50, 15],
  ["Xử lý nền xoang, che tủy nếu cần", 65, 8],
  ["Đặt vật liệu phục hồi theo lớp", 85, 15],
  ["Hoàn thiện hình thể, kiểm tra khớp cắn và đánh bóng", 100, 10],
]);

const inlayOnlayWorkflow = workflow([
  ["Đánh giá tổn thương và chỉ định inlay/onlay", 10, 10],
  ["Vô cảm, cô lập và tháo bỏ mô phục hồi cũ/sâu", 25, 15],
  ["Sửa soạn xoang theo nguyên tắc phục hình gián tiếp", 45, 25],
  ["Lấy dấu/scan, chọn màu và làm phục hồi tạm", 60, 20],
  ["Thử phục hình, kiểm tra sát khít và tiếp xúc", 80, 20],
  ["Gắn phục hình, chỉnh khớp cắn và đánh bóng", 100, 25],
]);

const postCoreWorkflow = workflow([
  ["Đánh giá răng sau nội nha và lượng mô còn lại", 15, 10],
  ["Chuẩn bị đường vào ống tủy và giữ nút chặn chóp", 35, 15],
  ["Thử chốt, chọn kích thước và xử lý bề mặt", 55, 10],
  ["Gắn chốt bằng xi măng phù hợp", 75, 12],
  ["Tái tạo cùi răng và tạo hình lưu giữ", 90, 15],
  ["Kiểm tra phim, khớp cắn và kế hoạch phục hình", 100, 8],
]);

const whiteningWorkflow = workflow([
  ["Khám màu răng, mô mềm và chống chỉ định", 15, 10],
  ["Chụp ảnh màu ban đầu và tư vấn kỳ vọng", 30, 8],
  ["Cách ly môi, nướu và mô mềm", 45, 10],
  ["Bôi thuốc tẩy trắng theo chu kỳ kiểm soát", 75, 35],
  ["Làm sạch, đánh giá màu sau tẩy", 90, 10],
  ["Dặn dò chống ê buốt và lịch duy trì", 100, 7],
]);

const endoWorkflow = workflow([
  ["Chẩn đoán nội nha và xác định răng điều trị", 10, 12, "Khám, thử tủy/gõ, đọc phim và xác định chỉ định điều trị tủy."],
  ["Vô cảm và cô lập bằng đê cao su", 20, 10, "Gây tê, đặt đê cao su hoặc cô lập tương đương để kiểm soát nhiễm khuẩn."],
  ["Mở đường vào buồng tủy", 35, 15, "Tạo đường vào bảo tồn mô răng, bộc lộ sàn buồng tủy và lấy mô tủy buồng."],
  ["Tìm miệng ống tủy và xác định chiều dài làm việc", 50, 20, "Dò miệng ống tủy, dùng máy định vị chóp/phim kiểm tra chiều dài làm việc."],
  ["Tạo hình, bơm rửa và khử khuẩn hệ thống ống tủy", 70, 35, "Sửa soạn ống tủy, bơm rửa hoạt hóa và kiểm soát nhiễm khuẩn trong ống tủy."],
  ["Thử cone và trám bít kín hệ thống ống tủy", 85, 25, "Thử côn gutta-percha, kiểm tra chiều dài, trám bít kín khít theo kỹ thuật phù hợp."],
  ["Phục hồi kín đường vào và kiểm tra khớp cắn", 95, 15, "Trám tạm hoặc trám vĩnh viễn kín mặt nhai, tránh tái nhiễm khuẩn."],
  ["Chụp phim kiểm tra và dặn dò phục hồi sau nội nha", 100, 8, "Đánh giá hình ảnh sau trám bít, dặn theo dõi đau và chỉ định mão nếu cần."],
]);

const endoRetreatWorkflow = workflow([
  ["Đánh giá nguyên nhân thất bại và tiên lượng", 10, 15],
  ["Vô cảm, cô lập và tháo phục hồi cũ khi cần", 20, 20],
  ["Mở lại đường vào, tháo vật liệu trám bít cũ", 40, 35],
  ["Tìm lại ống tủy bị bỏ sót hoặc tắc", 55, 25],
  ["Tạo hình lại, bơm rửa hoạt hóa và đặt thuốc nếu cần", 75, 40],
  ["Trám bít lại hệ thống ống tủy", 90, 30],
  ["Phục hồi kín đường vào, chụp phim và hẹn theo dõi", 100, 15],
]);

const pulpCappingWorkflow = workflow([
  ["Đánh giá mức độ sâu và khả năng bảo tồn tủy", 15, 8],
  ["Vô cảm, cô lập và làm sạch xoang sâu", 35, 12],
  ["Kiểm soát vùng sát tủy hoặc lộ tủy nhỏ", 55, 10],
  ["Đặt vật liệu che tủy và lớp lót bảo vệ", 75, 10],
  ["Trám kín phục hồi và kiểm tra khớp cắn", 95, 15],
  ["Dặn theo dõi triệu chứng và lịch kiểm tra tủy", 100, 5],
]);

const pulpotomyWorkflow = workflow([
  ["Chẩn đoán tủy răng sữa và chỉ định lấy tủy buồng", 15, 8],
  ["Vô cảm, cô lập và mở buồng tủy", 35, 12],
  ["Lấy mô tủy buồng và kiểm soát chảy máu", 55, 12],
  ["Đặt thuốc/vật liệu che tủy chân", 75, 10],
  ["Phục hồi kín thân răng", 95, 15],
  ["Dặn dò phụ huynh và hẹn theo dõi", 100, 5],
]);

const srpWorkflow = workflow([
  ["Khám nha chu và ghi nhận túi nha chu", 15, 15, "Ghi túi nha chu, chảy máu, lung lay, tiêu xương và vùng chỉ định điều trị."],
  ["Vô cảm vùng điều trị nếu cần", 25, 8],
  ["Lấy cao dưới nướu và mảng bám trong túi nha chu", 55, 30],
  ["Làm nhẵn bề mặt chân răng", 75, 25],
  ["Bơm rửa, kiểm soát chảy máu và đánh giá lại", 90, 10],
  ["Hướng dẫn vệ sinh, thuốc hỗ trợ và lịch tái đánh giá", 100, 10],
]);

const perioSurgeryWorkflow = workflow([
  ["Đánh giá nha chu, phim và kế hoạch phẫu thuật", 10, 15],
  ["Giải thích thủ thuật, ký đồng thuận và chuẩn bị vô khuẩn", 20, 15],
  ["Vô cảm và tạo vạt tiếp cận vùng bệnh lý", 40, 30],
  ["Làm sạch mô viêm, cao răng và xử lý bề mặt chân răng", 65, 35],
  ["Tạo hình mô/xương hoặc đặt vật liệu tái tạo nếu cần", 80, 25],
  ["Khâu đóng, cầm máu và đặt bảo vệ nha chu", 95, 20],
  ["Dặn hậu phẫu và hẹn cắt chỉ/tái khám", 100, 10],
]);

const gingivectomyWorkflow = workflow([
  ["Phân tích đường cười, viền nướu và sinh học mô", 15, 15],
  ["Đánh dấu đường viền nướu dự kiến", 30, 8],
  ["Vô cảm và cắt chỉnh mô nướu", 60, 25],
  ["Tạo hình viền nướu và cầm máu", 80, 15],
  ["Kiểm tra thẩm mỹ, chụp ảnh và dặn chăm sóc", 100, 10],
]);

const sensitivityWorkflow = workflow([
  ["Xác định nguyên nhân ê buốt cổ răng", 20, 8],
  ["Làm sạch vùng cổ răng và cô lập", 40, 5],
  ["Bôi thuốc chống ê hoặc che phủ ngà lộ", 70, 12],
  ["Kiểm tra đáp ứng kích thích", 90, 5],
  ["Hướng dẫn chải răng, kem chống ê và tái khám", 100, 5],
]);

const extractionWorkflow = workflow([
  ["Đánh giá chỉ định nhổ, phim và nguy cơ", 15, 10],
  ["Giải thích thủ thuật, đồng thuận và chuẩn bị dụng cụ", 25, 8],
  ["Vô cảm vùng nhổ", 40, 8],
  ["Làm lung lay và lấy răng ra khỏi ổ", 65, 20],
  ["Nạo sạch ổ răng, kiểm soát chảy máu", 85, 12],
  ["Cắn gạc, dặn hậu phẫu và kê đơn nếu cần", 100, 10],
]);

const wisdomExtractionWorkflow = workflow([
  ["Đánh giá phim, hướng mọc và liên quan thần kinh/xoang", 10, 15],
  ["Tư vấn nguy cơ, ký đồng thuận và chuẩn bị vô khuẩn", 20, 10],
  ["Vô cảm sâu vùng phẫu thuật", 35, 10],
  ["Tạo vạt, mở xương hoặc chia răng nếu cần", 60, 35],
  ["Lấy răng, nạo sạch nang/mô viêm", 78, 20],
  ["Bơm rửa, kiểm soát chảy máu và khâu đóng", 95, 20],
  ["Dặn hậu phẫu, kê đơn và hẹn cắt chỉ", 100, 10],
]);

const minorSurgeryWorkflow = workflow([
  ["Khám vùng tổn thương và lập kế hoạch tiểu phẫu", 10, 15],
  ["Chuẩn bị đồng thuận, vô khuẩn và vô cảm", 25, 15],
  ["Tiếp cận và xử lý tổn thương", 65, 45],
  ["Cầm máu, khâu đóng hoặc đặt dẫn lưu", 88, 20],
  ["Gửi mẫu xét nghiệm nếu cần", 95, 5],
  ["Dặn hậu phẫu và hẹn tái khám", 100, 10],
]);

const boneGraftWorkflow = workflow([
  ["Đánh giá thiếu xương và kế hoạch ghép", 10, 20],
  ["Chuẩn bị đồng thuận, vật liệu và vô khuẩn", 20, 15],
  ["Tạo vạt và chuẩn bị nền nhận xương", 40, 30],
  ["Đặt vật liệu ghép và màng che nếu cần", 70, 35],
  ["Khâu đóng không căng và kiểm soát cầm máu", 90, 20],
  ["Dặn hậu phẫu và lịch kiểm tra lành thương", 100, 10],
]);

const softTissueGraftWorkflow = workflow([
  ["Đánh giá tụt nướu, mô sừng hóa và vùng cho mô", 10, 15],
  ["Chuẩn bị đồng thuận, vô cảm và vô khuẩn", 25, 15],
  ["Chuẩn bị nền nhận ghép", 45, 25],
  ["Lấy mô ghép hoặc chuẩn bị vật liệu thay thế", 65, 25],
  ["Cố định mô ghép và khâu đóng", 90, 30],
  ["Dặn chăm sóc mô mềm và hẹn tái khám", 100, 10],
]);

const crownWorkflow = workflow([
  ["Đánh giá chỉ định mão, cùi răng và khớp cắn", 10, 12],
  ["Vô cảm, sửa soạn cùi và bảo tồn mô răng", 35, 35],
  ["Lấy dấu/scan, chọn màu và ghi khớp", 55, 20],
  ["Làm mão tạm và dặn chăm sóc", 65, 15],
  ["Thử mão, kiểm tra sát khít, tiếp xúc và màu", 85, 25],
  ["Gắn mão, chỉnh khớp cắn và đánh bóng", 100, 25],
]);

const bridgeWorkflow = workflow([
  ["Đánh giá khoảng mất răng và răng trụ", 10, 15],
  ["Lập kế hoạch số đơn vị cầu, vật liệu và màu", 20, 10],
  ["Sửa soạn răng trụ và kiểm soát mô mềm", 45, 45],
  ["Lấy dấu/scan, ghi khớp và làm cầu tạm", 60, 25],
  ["Thử sườn hoặc thử thẩm mỹ nếu cần", 75, 20],
  ["Thử cầu hoàn thiện, kiểm tra sát khít và vệ sinh dưới nhịp", 90, 25],
  ["Gắn cầu, chỉnh khớp và hướng dẫn vệ sinh", 100, 25],
]);

const veneerWorkflow = workflow([
  ["Phân tích nụ cười, màu răng và kỳ vọng thẩm mỹ", 10, 20],
  ["Thiết kế mockup/wax-up và duyệt hình thể", 25, 25],
  ["Sửa soạn veneer bảo tồn men", 45, 35],
  ["Lấy dấu/scan, chọn màu và làm veneer tạm", 60, 25],
  ["Thử veneer, duyệt màu và hình thể", 80, 30],
  ["Dán veneer, làm sạch xi măng và đánh bóng", 100, 35],
]);

const removableDentureWorkflow = workflow([
  ["Khám mất răng, sống hàm và khớp cắn", 10, 15],
  ["Lấy dấu sơ khởi", 25, 15],
  ["Lấy dấu chức năng và ghi tương quan hàm", 45, 25],
  ["Thử răng, kiểm tra thẩm mỹ và phát âm", 65, 25],
  ["Giao hàm, chỉnh đau cấn ban đầu", 85, 25],
  ["Tái khám chỉnh hàm sau sử dụng", 100, 15],
]);

const completeDentureWorkflow = workflow([
  ["Khám sống hàm, niêm mạc và tương quan hai hàm", 10, 20],
  ["Lấy dấu sơ khởi và làm khay cá nhân", 25, 20],
  ["Lấy dấu chức năng toàn hàm", 45, 30],
  ["Ghi tương quan hàm và chọn răng", 60, 25],
  ["Thử răng, duyệt thẩm mỹ và phát âm", 75, 30],
  ["Giao hàm toàn phần và hướng dẫn sử dụng", 90, 30],
  ["Tái khám chỉnh đau, khớp cắn và độ ổn định", 100, 20],
]);

const nightGuardWorkflow = workflow([
  ["Đánh giá nghiến răng, mòn răng và khớp thái dương hàm", 20, 10],
  ["Lấy dấu/scan hai hàm và ghi khớp", 45, 15],
  ["Thiết kế và chế tác máng", 65, 10],
  ["Thử máng, chỉnh điểm chạm và độ ôm", 90, 20],
  ["Giao máng, hướng dẫn đeo và vệ sinh", 100, 10],
]);

const implantWorkflow = workflow([
  ["Đánh giá toàn thân, phim CBCT và kế hoạch implant", 10, 25],
  ["Tư vấn phương án, ký đồng thuận và chuẩn bị phẫu thuật", 20, 20],
  ["Vô cảm và tạo vạt/đường vào", 35, 20],
  ["Khoan tạo vị trí theo trình tự", 55, 35],
  ["Đặt implant, kiểm tra lực siết và vị trí", 75, 20],
  ["Đặt vít lành thương/vít che phủ và khâu đóng", 90, 20],
  ["Chụp phim kiểm tra, dặn hậu phẫu và hẹn tái khám", 100, 15],
]);

const implantConsultWorkflow = workflow([
  ["Khám mất răng và mong muốn phục hình", 20, 15],
  ["Đọc phim/CBCT và đánh giá xương, xoang, thần kinh", 45, 20],
  ["Lập phương án implant, ghép xương/nâng xoang nếu cần", 70, 20],
  ["Tư vấn chi phí, thời gian và điều kiện điều trị", 90, 15],
  ["Lưu kế hoạch và đặt lịch phẫu thuật", 100, 10],
]);

const abutmentWorkflow = workflow([
  ["Đánh giá lành thương và tích hợp implant", 20, 10],
  ["Bộc lộ implant hoặc tháo vít lành thương", 40, 10],
  ["Thử và siết abutment theo lực khuyến nghị", 70, 15],
  ["Chụp phim kiểm tra vị trí abutment", 85, 8],
  ["Lấy dấu/scan phục hình hoặc đặt mão tạm", 100, 15],
]);

const implantRestorationWorkflow = workflow([
  ["Đánh giá mô quanh implant và abutment", 15, 10],
  ["Lấy dấu/scan implant và ghi khớp", 35, 20],
  ["Thử sườn/mão trên implant", 60, 20],
  ["Gắn hoặc bắt vít phục hình", 85, 25],
  ["Kiểm tra khớp cắn, vệ sinh và chụp phim", 100, 15],
]);

const sinusLiftWorkflow = workflow([
  ["Đánh giá CBCT, chiều cao xương và xoang hàm", 10, 20],
  ["Tư vấn nguy cơ, đồng thuận và chuẩn bị vô khuẩn", 20, 15],
  ["Tạo đường vào xoang và nâng màng xoang", 50, 45],
  ["Đặt vật liệu ghép xương", 75, 30],
  ["Đóng vạt, cầm máu và kiểm tra ổn định", 90, 20],
  ["Dặn hậu phẫu nâng xoang và lịch tái khám", 100, 10],
]);

const bracketOrthoWorkflow = workflow([
  ["Thu thập hồ sơ chỉnh nha", 10, 30, "Ảnh, phim, scan/mẫu hàm, phân tích khớp cắn và nhu cầu điều trị."],
  ["Lập kế hoạch và ký đồng thuận chỉnh nha", 20, 30],
  ["Gắn mắc cài hoặc khí cụ khởi đầu", 35, 60],
  ["Sắp đều và làm phẳng cung răng", 55, 90],
  ["Đóng khoảng, kiểm soát neo chặn và tương quan hàm", 75, 120],
  ["Hoàn thiện khớp cắn và thẩm mỹ nụ cười", 90, 90],
  ["Tháo mắc cài, đánh bóng và lấy dấu hàm duy trì", 97, 60],
  ["Giao hàm duy trì và thiết lập lịch theo dõi", 100, 30],
]);

const alignerWorkflow = workflow([
  ["Thu thập hồ sơ, scan và ảnh chỉnh nha", 10, 30],
  ["Thiết kế kế hoạch khay và duyệt mô phỏng", 25, 30],
  ["Giao khay đầu, gắn attachment/IPR nếu cần", 40, 60],
  ["Theo dõi thay khay và độ khít", 60, 90],
  ["Tinh chỉnh giữa liệu trình hoặc đặt refinement", 80, 60],
  ["Hoàn tất di chuyển răng và đánh giá khớp cắn", 95, 45],
  ["Giao hàm duy trì và hướng dẫn đeo", 100, 30],
]);

const retainerWorkflow = workflow([
  ["Đánh giá sau chỉnh nha và nguy cơ tái phát", 20, 10],
  ["Lấy dấu/scan hàm duy trì", 45, 15],
  ["Chế tác hàm duy trì", 65, 10],
  ["Thử hàm, chỉnh độ ôm và điểm cấn", 90, 20],
  ["Giao hàm và hướng dẫn lịch đeo", 100, 10],
]);

const functionalApplianceWorkflow = workflow([
  ["Đánh giá tăng trưởng, khớp cắn và phim sọ nghiêng", 15, 25],
  ["Lập kế hoạch khí cụ và giải thích hợp tác", 30, 20],
  ["Lấy dấu/scan và ghi khớp xây dựng", 50, 25],
  ["Giao khí cụ, chỉnh độ ôm và hướng dẫn đeo", 70, 30],
  ["Theo dõi đáp ứng tăng trưởng và chỉnh khí cụ", 90, 60],
  ["Hoàn tất giai đoạn chức năng và kế hoạch duy trì", 100, 20],
]);

const pediatricExamWorkflow = workflow([
  ["Làm quen trẻ và khai thác thông tin phụ huynh", 20, 10],
  ["Khám răng sữa, răng vĩnh viễn và thói quen", 45, 15],
  ["Đánh giá nguy cơ sâu răng và vệ sinh", 65, 10],
  ["Tư vấn phụ huynh về điều trị và dự phòng", 90, 15],
  ["Ghi hồ sơ, hẹn tái khám và dặn chăm sóc", 100, 5],
]);

const primaryFillingWorkflow = workflow([
  ["Khám sâu răng sữa và đánh giá khả năng giữ răng", 15, 8],
  ["Kiểm soát hành vi, vô cảm nếu cần và cô lập", 35, 10],
  ["Làm sạch mô sâu bảo tồn", 55, 12],
  ["Đặt vật liệu trám phù hợp", 80, 12],
  ["Kiểm tra khớp cắn và dặn phụ huynh theo dõi", 100, 8],
]);

const primaryExtractionWorkflow = workflow([
  ["Đánh giá chỉ định nhổ răng sữa và thời điểm mọc răng kế tiếp", 20, 8],
  ["Giải thích cho phụ huynh/trẻ và vô cảm", 40, 8],
  ["Nhổ răng sữa nhẹ nhàng", 70, 10],
  ["Cầm máu và kiểm tra chân răng", 90, 8],
  ["Dặn chăm sóc, ăn uống và giữ khoảng nếu cần", 100, 5],
]);

const spaceMaintainerWorkflow = workflow([
  ["Đánh giá mất răng sữa sớm và khoảng cần giữ", 15, 15],
  ["Lấy dấu/scan và chọn loại khí cụ giữ khoảng", 40, 15],
  ["Thử khung/vòng và chỉnh sát khít", 65, 20],
  ["Gắn khí cụ và kiểm tra khớp cắn", 90, 20],
  ["Hướng dẫn vệ sinh và lịch tái khám", 100, 10],
]);

const emergencyPainWorkflow = workflow([
  ["Sàng lọc cấp cứu và dấu hiệu nguy hiểm", 15, 5],
  ["Khai thác triệu chứng đau, sưng và tiền sử", 30, 8],
  ["Khám nhanh, test cần thiết và đọc phim", 55, 12],
  ["Xử trí giảm đau/giảm nhiễm trùng ban đầu", 80, 20],
  ["Kê đơn, dặn dò và hẹn điều trị nguyên nhân", 100, 10],
]);

const abscessDrainageWorkflow = workflow([
  ["Đánh giá ổ áp xe, đường lan và toàn trạng", 15, 10],
  ["Vô cảm, sát khuẩn và chuẩn bị dẫn lưu", 30, 10],
  ["Rạch mở và dẫn lưu mủ", 65, 20],
  ["Bơm rửa, đặt dẫn lưu nếu cần", 85, 10],
  ["Kê đơn, dặn theo dõi và hẹn xử trí nguyên nhân", 100, 10],
]);

const recementWorkflow = workflow([
  ["Đánh giá mão/cầu tạm và răng trụ", 20, 8],
  ["Làm sạch xi măng cũ trên phục hình và răng", 45, 10],
  ["Thử lại, kiểm tra sát khít và khớp cắn", 65, 8],
  ["Gắn lại bằng xi măng tạm phù hợp", 90, 10],
  ["Dặn tránh nhai cứng và hẹn phục hình chính thức", 100, 5],
]);

export const serviceCatalog: DentalServiceCatalogItem[] = [
  { id: "exam", code: "KHAM", category: "diagnostics", name: "Khám và tư vấn", nameEn: "Exam and consultation", price: 250000, defaultDurationMinutes: 75, targetMode: "MOUTH", steps: examWorkflow },
  { id: "recall", code: "TAIK", category: "diagnostics", name: "Tái khám", nameEn: "Recall visit", price: 150000, defaultDurationMinutes: 35, targetMode: "MOUTH", steps: workflow([["Kiểm tra triệu chứng và thay đổi từ lần trước", 25, 8], ["Đánh giá vùng đã điều trị hoặc vấn đề đang theo dõi", 55, 12], ["Chụp phim/ảnh kiểm tra nếu cần", 75, 8], ["Điều chỉnh kế hoạch và dặn dò", 100, 7]]) },
  { id: "xray-pa", code: "XQ", category: "diagnostics", name: "Chụp X-quang quanh chóp", nameEn: "Periapical X-ray", price: 120000, defaultDurationMinutes: 20, targetMode: "TOOTH", steps: imageWorkflow },
  { id: "panoramic", code: "PAN", category: "diagnostics", name: "Chụp phim toàn cảnh", nameEn: "Panoramic X-ray", price: 250000, defaultDurationMinutes: 20, targetMode: "MOUTH", steps: imageWorkflow },
  { id: "cephalometric", code: "CEP", category: "diagnostics", name: "Chụp phim sọ nghiêng", nameEn: "Cephalometric X-ray", price: 250000, defaultDurationMinutes: 20, targetMode: "MOUTH", steps: imageWorkflow },
  { id: "cbct", code: "CBCT", category: "diagnostics", name: "Chụp CBCT", nameEn: "CBCT scan", price: 900000, defaultDurationMinutes: 40, targetMode: "MOUTH", steps: cbctWorkflow },
  { id: "scaling", code: "LCR", category: "preventive", name: "Lấy cao răng", nameEn: "Scaling", price: 450000, defaultDurationMinutes: 60, targetMode: "MOUTH", steps: scalingWorkflow },
  { id: "polishing", code: "DBR", category: "preventive", name: "Đánh bóng răng", nameEn: "Tooth polishing", price: 250000, defaultDurationMinutes: 35, targetMode: "MOUTH", steps: polishingWorkflow },
  { id: "fluoride", code: "FLR", category: "preventive", name: "Bôi fluoride", nameEn: "Fluoride varnish", price: 300000, defaultDurationMinutes: 25, targetMode: "MOUTH", steps: fluorideWorkflow },
  { id: "sealant", code: "BHR", category: "preventive", name: "Trám bít hố rãnh", nameEn: "Pit and fissure sealant", price: 350000, defaultDurationMinutes: 35, targetMode: "TOOTH_OR_GROUP", steps: sealantWorkflow },
  { id: "perio-maintenance", code: "VSNC", category: "preventive", name: "Vệ sinh nha chu duy trì", nameEn: "Periodontal maintenance cleaning", price: 650000, defaultDurationMinutes: 65, targetMode: "MOUTH", steps: perioMaintenanceWorkflow },
  { id: "filling-composite", code: "TRC", category: "restorative", name: "Trám composite", nameEn: "Composite filling", price: 650000, defaultDurationMinutes: 70, targetMode: "TOOTH", steps: fillingWorkflow },
  { id: "filling-gic", code: "TRG", category: "restorative", name: "Trám glass ionomer", nameEn: "Glass ionomer filling", price: 450000, defaultDurationMinutes: 55, targetMode: "TOOTH", steps: fillingWorkflow },
  { id: "inlay-onlay", code: "INL", category: "restorative", name: "Inlay / Onlay", nameEn: "Inlay / Onlay restoration", price: 3500000, defaultDurationMinutes: 120, targetMode: "TOOTH", steps: inlayOnlayWorkflow },
  { id: "post-core", code: "CHOT", category: "restorative", name: "Chốt sợi và tái tạo cùi", nameEn: "Fiber post and core build-up", price: 1200000, defaultDurationMinutes: 90, targetMode: "TOOTH", steps: postCoreWorkflow },
  { id: "whitening", code: "TTR", category: "restorative", name: "Tẩy trắng răng", nameEn: "Tooth whitening", price: 2500000, defaultDurationMinutes: 90, targetMode: "MOUTH", steps: whiteningWorkflow },
  { id: "endo", code: "CTU", category: "endodontics", name: "Điều trị tủy", nameEn: "Root canal treatment", price: 1800000, defaultDurationMinutes: 140, targetMode: "TOOTH", consentRequired: true, steps: endoWorkflow },
  { id: "endo-retreat", code: "TDT", category: "endodontics", name: "Tái điều trị tủy", nameEn: "Root canal retreatment", price: 2500000, defaultDurationMinutes: 170, targetMode: "TOOTH", consentRequired: true, steps: endoRetreatWorkflow },
  { id: "pulp-capping", code: "CHT", category: "endodontics", name: "Che tủy bảo tồn", nameEn: "Pulp capping", price: 700000, defaultDurationMinutes: 60, targetMode: "TOOTH", steps: pulpCappingWorkflow },
  { id: "pulpotomy-primary", code: "TBS", category: "pediatric", name: "Lấy tủy buồng răng sữa", nameEn: "Primary tooth pulpotomy", price: 900000, defaultDurationMinutes: 65, targetMode: "TOOTH", steps: pulpotomyWorkflow },
  { id: "scaling-root-planing", code: "NSR", category: "periodontics", name: "Điều trị nha chu không phẫu thuật", nameEn: "Scaling and root planing", price: 1200000, defaultDurationMinutes: 90, targetMode: "QUADRANT", steps: srpWorkflow },
  { id: "perio-surgery", code: "PTC", category: "periodontics", name: "Phẫu thuật nha chu", nameEn: "Periodontal surgery", price: 3500000, defaultDurationMinutes: 150, targetMode: "QUADRANT", consentRequired: true, steps: perioSurgeryWorkflow },
  { id: "gingivectomy", code: "CNG", category: "periodontics", name: "Cắt chỉnh nướu thẩm mỹ", nameEn: "Esthetic gingivectomy", price: 1800000, defaultDurationMinutes: 80, targetMode: "TOOTH_OR_GROUP", consentRequired: true, steps: gingivectomyWorkflow },
  { id: "sensitivity", code: "ELB", category: "periodontics", name: "Xử lý ê buốt cổ răng", nameEn: "Cervical sensitivity treatment", price: 500000, defaultDurationMinutes: 35, targetMode: "TOOTH_OR_GROUP", steps: sensitivityWorkflow },
  { id: "extraction-simple", code: "NHO", category: "surgery", name: "Nhổ răng thường", nameEn: "Simple extraction", price: 900000, defaultDurationMinutes: 65, targetMode: "TOOTH", consentRequired: true, steps: extractionWorkflow },
  { id: "extraction-wisdom", code: "NRK", category: "surgery", name: "Nhổ răng khôn", nameEn: "Wisdom tooth extraction", price: 2500000, defaultDurationMinutes: 120, targetMode: "TOOTH", consentRequired: true, steps: wisdomExtractionWorkflow },
  { id: "oral-surgery", code: "TPT", category: "surgery", name: "Tiểu phẫu thuật miệng", nameEn: "Minor oral surgery", price: 3500000, defaultDurationMinutes: 120, targetMode: "TOOTH_OR_GROUP", consentRequired: true, steps: minorSurgeryWorkflow },
  { id: "bone-graft", code: "GXU", category: "surgery", name: "Ghép xương", nameEn: "Bone graft", price: 6500000, defaultDurationMinutes: 150, targetMode: "TOOTH_OR_GROUP", consentRequired: true, steps: boneGraftWorkflow },
  { id: "soft-tissue-graft", code: "GMM", category: "surgery", name: "Ghép mô mềm", nameEn: "Soft tissue graft", price: 4500000, defaultDurationMinutes: 130, targetMode: "TOOTH_OR_GROUP", consentRequired: true, steps: softTissueGraftWorkflow },
  { id: "crown-ceramic", code: "MSU", category: "prosthodontics", name: "Mão sứ", nameEn: "Ceramic crown", price: 4500000, defaultDurationMinutes: 150, targetMode: "TOOTH", steps: crownWorkflow },
  { id: "crown-zirconia", code: "ZIR", category: "prosthodontics", name: "Mão zirconia", nameEn: "Zirconia crown", price: 6500000, defaultDurationMinutes: 150, targetMode: "TOOTH", steps: crownWorkflow },
  { id: "bridge", code: "CDR", category: "prosthodontics", name: "Cầu răng", nameEn: "Dental bridge", price: 12000000, defaultDurationMinutes: 180, targetMode: "TOOTH_OR_GROUP", steps: bridgeWorkflow },
  { id: "veneer", code: "VNR", category: "prosthodontics", name: "Veneer sứ", nameEn: "Porcelain veneer", price: 7000000, defaultDurationMinutes: 170, targetMode: "TOOTH", steps: veneerWorkflow },
  { id: "removable-denture", code: "HTL", category: "prosthodontics", name: "Hàm tháo lắp", nameEn: "Removable denture", price: 3500000, defaultDurationMinutes: 120, targetMode: "TOOTH_OR_GROUP", steps: removableDentureWorkflow },
  { id: "complete-denture", code: "HTP", category: "prosthodontics", name: "Hàm toàn phần", nameEn: "Complete denture", price: 9000000, defaultDurationMinutes: 180, targetMode: "ARCH", steps: completeDentureWorkflow },
  { id: "night-guard", code: "MGN", category: "prosthodontics", name: "Máng nhai", nameEn: "Night guard", price: 1800000, defaultDurationMinutes: 60, targetMode: "ARCH", steps: nightGuardWorkflow },
  { id: "implant", code: "IMPL", category: "implant", name: "Cấy implant", nameEn: "Dental implant placement", price: 18000000, defaultDurationMinutes: 160, targetMode: "TOOTH", consentRequired: true, steps: implantWorkflow },
  { id: "implant-consult", code: "TVI", category: "implant", name: "Tư vấn implant", nameEn: "Implant consult", price: 800000, defaultDurationMinutes: 90, targetMode: "TOOTH_OR_GROUP", steps: implantConsultWorkflow },
  { id: "implant-abutment", code: "ABT", category: "implant", name: "Abutment implant", nameEn: "Implant abutment", price: 4500000, defaultDurationMinutes: 70, targetMode: "TOOTH", steps: abutmentWorkflow },
  { id: "implant-restoration", code: "PHI", category: "implant", name: "Phục hình trên implant", nameEn: "Implant restoration", price: 9000000, defaultDurationMinutes: 100, targetMode: "TOOTH", steps: implantRestorationWorkflow },
  { id: "sinus-lift", code: "NXS", category: "implant", name: "Nâng xoang", nameEn: "Sinus lift", price: 12000000, defaultDurationMinutes: 160, targetMode: "TOOTH_OR_GROUP", consentRequired: true, steps: sinusLiftWorkflow },
  { id: "orthodontics", code: "CHN", category: "orthodontics", name: "Chỉnh nha mắc cài", nameEn: "Bracket orthodontics", price: 32000000, defaultDurationMinutes: 510, targetMode: "ARCH", consentRequired: true, steps: bracketOrthoWorkflow },
  { id: "aligner", code: "ALN", category: "orthodontics", name: "Chỉnh nha khay trong", nameEn: "Clear aligner orthodontics", price: 55000000, defaultDurationMinutes: 345, targetMode: "ARCH", consentRequired: true, steps: alignerWorkflow },
  { id: "ortho-retainer", code: "DUY", category: "orthodontics", name: "Hàm duy trì sau chỉnh nha", nameEn: "Orthodontic retainer", price: 2500000, defaultDurationMinutes: 65, targetMode: "ARCH", steps: retainerWorkflow },
  { id: "functional-appliance", code: "KCN", category: "orthodontics", name: "Khí cụ chức năng", nameEn: "Functional appliance", price: 6500000, defaultDurationMinutes: 135, targetMode: "ARCH", consentRequired: true, steps: functionalApplianceWorkflow },
  { id: "pediatric-exam", code: "PET", category: "pediatric", name: "Khám nha trẻ em", nameEn: "Pediatric dental exam", price: 200000, defaultDurationMinutes: 55, targetMode: "MOUTH", steps: pediatricExamWorkflow },
  { id: "primary-filling", code: "RSS", category: "pediatric", name: "Trám răng sữa", nameEn: "Primary tooth filling", price: 450000, defaultDurationMinutes: 50, targetMode: "TOOTH", steps: primaryFillingWorkflow },
  { id: "primary-extraction", code: "NRS", category: "pediatric", name: "Nhổ răng sữa", nameEn: "Primary tooth extraction", price: 350000, defaultDurationMinutes: 40, targetMode: "TOOTH", consentRequired: true, steps: primaryExtractionWorkflow },
  { id: "space-maintainer", code: "GKC", category: "pediatric", name: "Giữ khoảng", nameEn: "Space maintainer", price: 1800000, defaultDurationMinutes: 80, targetMode: "TOOTH_OR_GROUP", steps: spaceMaintainerWorkflow },
  { id: "dental-emergency", code: "CAP", category: "emergency", name: "Cấp cứu đau răng", nameEn: "Dental emergency visit", price: 500000, defaultDurationMinutes: 55, targetMode: "TOOTH_OR_GROUP", steps: emergencyPainWorkflow },
  { id: "abscess-drainage", code: "APX", category: "emergency", name: "Rạch dẫn lưu áp xe", nameEn: "Abscess drainage", price: 1500000, defaultDurationMinutes: 60, targetMode: "TOOTH_OR_GROUP", consentRequired: true, steps: abscessDrainageWorkflow },
  { id: "temporary-crown-recement", code: "GTT", category: "emergency", name: "Gắn lại mão/cầu tạm", nameEn: "Temporary crown or bridge recement", price: 500000, defaultDurationMinutes: 45, targetMode: "TOOTH_OR_GROUP", steps: recementWorkflow },
];
