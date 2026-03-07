/**
 * MONO Medical Knowledge Base
 * 병원 전과 의료용어 범용 DB
 * 
 * 구조: { ko, en, zh, ja, vi }
 * 사용법: 번역 요청 시 과(dept) 컨텍스트에 맞는 용어를 systemPrompt에 자동 주입
 * 
 * 수록 범위:
 *  - 공통 병원 행정/절차 용어
 *  - 성형외과 / 미용피부과
 *  - 내과 / 외과 / 응급의학과
 *  - 산부인과 / 소아과
 *  - 정형외과 / 신경과 / 피부과
 *  - 안과 / 이비인후과 / 치과
 *  - 검사/처치/약물 공통
 */

// ─────────────────────────────────────────────
// 1. 공통 병원 행정 / 절차
// ─────────────────────────────────────────────
export const COMMON_HOSPITAL = [
  { ko: "접수", en: "registration / check-in", zh: "挂号", ja: "受付", vi: "đăng ký khám" },
  { ko: "원무과", en: "admissions office", zh: "住院处", ja: "医事課", vi: "phòng hành chính" },
  { ko: "진료비", en: "medical fee / copay", zh: "诊疗费", ja: "診療費", vi: "chi phí khám" },
  { ko: "보험증", en: "insurance card", zh: "保险证", ja: "保険証", vi: "thẻ bảo hiểm" },
  { ko: "건강보험", en: "national health insurance", zh: "国民健康保险", ja: "健康保険", vi: "bảo hiểm y tế quốc gia" },
  { ko: "입원", en: "hospitalization / admission", zh: "住院", ja: "入院", vi: "nhập viện" },
  { ko: "퇴원", en: "discharge", zh: "出院", ja: "退院", vi: "xuất viện" },
  { ko: "외래", en: "outpatient", zh: "门诊", ja: "外来", vi: "ngoại trú" },
  { ko: "응급실", en: "emergency room (ER)", zh: "急诊室", ja: "救急室", vi: "phòng cấp cứu" },
  { ko: "진찰실", en: "examination room", zh: "诊室", ja: "診察室", vi: "phòng khám" },
  { ko: "대기실", en: "waiting room", zh: "候诊室", ja: "待合室", vi: "phòng chờ" },
  { ko: "처방전", en: "prescription", zh: "处方", ja: "処方箋", vi: "đơn thuốc" },
  { ko: "예약", en: "appointment / reservation", zh: "预约", ja: "予約", vi: "đặt lịch hẹn" },
  { ko: "검사 결과", en: "test results", zh: "检查结果", ja: "検査結果", vi: "kết quả xét nghiệm" },
  { ko: "동의서", en: "informed consent form", zh: "同意书", ja: "同意書", vi: "phiếu đồng ý" },
  { ko: "의무기록", en: "medical record / chart", zh: "病历", ja: "カルテ", vi: "hồ sơ bệnh án" },
  { ko: "수술실", en: "operating room (OR)", zh: "手术室", ja: "手術室", vi: "phòng phẫu thuật" },
  { ko: "회복실", en: "recovery room", zh: "恢复室", ja: "回復室", vi: "phòng hồi sức" },
  { ko: "중환자실", en: "intensive care unit (ICU)", zh: "重症监护室", ja: "集中治療室（ICU）", vi: "phòng hồi sức tích cực (ICU)" },
  { ko: "통증", en: "pain", zh: "疼痛", ja: "痛み", vi: "đau" },
  { ko: "알레르기", en: "allergy", zh: "过敏", ja: "アレルギー", vi: "dị ứng" },
  { ko: "부작용", en: "side effect", zh: "副作用", ja: "副作用", vi: "tác dụng phụ" },
  { ko: "금식", en: "fasting (NPO)", zh: "禁食", ja: "絶食", vi: "nhịn ăn" },
  { ko: "마취", en: "anesthesia", zh: "麻醉", ja: "麻酔", vi: "gây mê / gây tê" },
  { ko: "국소마취", en: "local anesthesia", zh: "局部麻醉", ja: "局所麻酔", vi: "gây tê cục bộ" },
  { ko: "전신마취", en: "general anesthesia", zh: "全身麻醉", ja: "全身麻酔", vi: "gây mê toàn thân" },
  { ko: "수혈", en: "blood transfusion", zh: "输血", ja: "輸血", vi: "truyền máu" },
  { ko: "봉합", en: "suture / stitches", zh: "缝合", ja: "縫合", vi: "khâu vết thương" },
  { ko: "실밥제거", en: "suture removal", zh: "拆线", ja: "抜糸", vi: "cắt chỉ" },
  { ko: "소독", en: "disinfection / wound care", zh: "消毒", ja: "消毒", vi: "khử trùng" },
  { ko: "붕대", en: "bandage / dressing", zh: "绷带", ja: "包帯", vi: "băng bó" },
  { ko: "주사", en: "injection", zh: "注射", ja: "注射", vi: "tiêm" },
  { ko: "수액", en: "IV drip / intravenous fluid", zh: "输液", ja: "点滴", vi: "truyền dịch" },
  { ko: "혈압", en: "blood pressure", zh: "血压", ja: "血圧", vi: "huyết áp" },
  { ko: "맥박", en: "pulse rate", zh: "脉搏", ja: "脈拍", vi: "nhịp mạch" },
  { ko: "체온", en: "body temperature", zh: "体温", ja: "体温", vi: "nhiệt độ cơ thể" },
  { ko: "산소포화도", en: "oxygen saturation (SpO2)", zh: "血氧饱和度", ja: "酸素飽和度", vi: "độ bão hòa oxy" },
];

// ─────────────────────────────────────────────
// 2. 성형외과 (Plastic Surgery)
// ─────────────────────────────────────────────
export const PLASTIC_SURGERY = [
  // 눈
  { ko: "쌍꺼풀", en: "double eyelid", zh: "双眼皮", ja: "二重まぶた", vi: "mí mắt đôi" },
  { ko: "쌍꺼풀 수술", en: "double eyelid surgery / blepharoplasty", zh: "双眼皮手术", ja: "二重手術", vi: "phẫu thuật mí mắt đôi" },
  { ko: "비절개 쌍꺼풀", en: "non-incisional double eyelid (buried suture method)", zh: "埋线双眼皮", ja: "埋没法", vi: "cắt mí không xẻ" },
  { ko: "절개 쌍꺼풀", en: "incisional double eyelid surgery", zh: "切开法双眼皮", ja: "切開法", vi: "cắt mí xẻ" },
  { ko: "눈매교정", en: "ptosis correction / levator advancement", zh: "提肌矫正", ja: "眼瞼下垂手術", vi: "chỉnh mí mắt sụp" },
  { ko: "앞트임", en: "epicanthoplasty (medial canthoplasty)", zh: "开眼角（内眦赘皮）手术", ja: "目頭切開", vi: "phẫu thuật đuôi mắt trong" },
  { ko: "뒤트임", en: "lateral canthoplasty", zh: "开外眼角手术", ja: "目尻切開", vi: "phẫu thuật đuôi mắt ngoài" },
  { ko: "눈밑지방재배치", en: "lower eyelid fat repositioning", zh: "下眼睑脂肪重置", ja: "目の下の脂肪再配置", vi: "phân bố lại mỡ vùng mắt dưới" },
  { ko: "애교살", en: "love band (lower eyelid filler)", zh: "卧蚕", ja: "涙袋", vi: "mỡ bọng mắt dưới" },

  // 코
  { ko: "코성형", en: "rhinoplasty", zh: "鼻整形手术", ja: "鼻整形", vi: "phẫu thuật chỉnh hình mũi" },
  { ko: "콧대 높이기", en: "dorsal augmentation / bridge augmentation", zh: "隆鼻梁", ja: "鼻梁増高", vi: "nâng sống mũi" },
  { ko: "코끝 성형", en: "tip plasty / nasal tip refinement", zh: "鼻尖整形", ja: "鼻尖形成", vi: "tạo hình đầu mũi" },
  { ko: "콧구멍 축소", en: "alar reduction / nostril reduction", zh: "鼻翼缩小", ja: "小鼻縮小", vi: "thu nhỏ cánh mũi" },
  { ko: "매부리코", en: "hump nose / aquiline nose", zh: "鹰钩鼻", ja: "ワシ鼻", vi: "mũi khoằm" },
  { ko: "보형물", en: "implant / prosthesis", zh: "假体", ja: "インプラント", vi: "vật liệu cấy ghép" },
  { ko: "실리콘 보형물", en: "silicone implant", zh: "硅胶假体", ja: "シリコンインプラント", vi: "độn silicon" },
  { ko: "자가연골", en: "autologous cartilage graft", zh: "自体软骨", ja: "自家軟骨", vi: "sụn tự thân" },

  // 얼굴
  { ko: "윤곽 수술", en: "facial contouring surgery", zh: "面部轮廓手术", ja: "輪郭形成術", vi: "phẫu thuật tạo khung mặt" },
  { ko: "광대뼈 축소", en: "zygoma reduction", zh: "颧骨缩小", ja: "頬骨削り", vi: "thu nhỏ xương gò má" },
  { ko: "사각턱 수술", en: "square jaw reduction (mandible reduction)", zh: "下颌角手术", ja: "エラ削り", vi: "phẫu thuật thu nhỏ hàm vuông" },
  { ko: "턱끝 성형", en: "genioplasty / chin augmentation", zh: "下巴整形", ja: "オトガイ形成術", vi: "phẫu thuật tạo hình cằm" },
  { ko: "지방이식", en: "fat grafting / fat transfer", zh: "脂肪移植", ja: "脂肪移植", vi: "cấy ghép mỡ" },
  { ko: "안면윤곽", en: "facial contouring", zh: "面部轮廓", ja: "顔面輪郭", vi: "đường nét khuôn mặt" },
  { ko: "리프팅", en: "facelift / rhytidectomy", zh: "面部提升术", ja: "フェイスリフト", vi: "nâng mặt" },
  { ko: "실 리프팅", en: "thread lift", zh: "线雕提升", ja: "スレッドリフト", vi: "nâng chỉ" },
  { ko: "눈썹 거상술", en: "brow lift / forehead lift", zh: "额头提升", ja: "ブロウリフト", vi: "nâng cung mày" },

  // 가슴
  { ko: "가슴 확대", en: "breast augmentation / augmentation mammaplasty", zh: "隆胸手术", ja: "豊胸手術", vi: "phẫu thuật nâng ngực" },
  { ko: "가슴 축소", en: "breast reduction / reduction mammaplasty", zh: "缩胸手术", ja: "乳房縮小術", vi: "phẫu thuật thu nhỏ ngực" },
  { ko: "가슴 거상술", en: "breast lift / mastopexy", zh: "乳房提升术", ja: "乳房挙上術", vi: "nâng ngực sa trễ" },
  { ko: "유두 교정", en: "nipple correction", zh: "乳头矫正", ja: "乳頭矯正", vi: "chỉnh hình đầu vú" },
  { ko: "구형구축", en: "capsular contracture", zh: "包膜挛缩", ja: "被膜拘縮", vi: "co rút bao xơ" },

  // 바디
  { ko: "지방흡입", en: "liposuction", zh: "吸脂手术", ja: "脂肪吸引", vi: "hút mỡ" },
  { ko: "복부성형", en: "abdominoplasty / tummy tuck", zh: "腹部整形", ja: "腹部形成術", vi: "phẫu thuật bụng" },
  { ko: "허벅지 지방흡입", en: "thigh liposuction", zh: "大腿吸脂", ja: "太もも脂肪吸引", vi: "hút mỡ đùi" },
  { ko: "팔뚝 지방흡입", en: "arm liposuction / brachioplasty", zh: "手臂吸脂", ja: "二の腕脂肪吸引", vi: "hút mỡ bắp tay" },

  // 기타
  { ko: "흉터 제거", en: "scar removal / scar revision", zh: "疤痕去除", ja: "傷跡修正", vi: "xóa sẹo" },
  { ko: "켈로이드", en: "keloid", zh: "瘢痕疙瘩", ja: "ケロイド", vi: "sẹo lồi" },
  { ko: "재수술", en: "revision surgery", zh: "修复手术", ja: "修正手術", vi: "phẫu thuật chỉnh sửa" },
  { ko: "부종", en: "swelling / edema", zh: "肿胀", ja: "腫れ", vi: "sưng / phù nề" },
  { ko: "멍", en: "bruising / ecchymosis", zh: "瘀伤", ja: "内出血", vi: "bầm tím" },
  { ko: "회복기간", en: "recovery period / downtime", zh: "恢复期", ja: "回復期間", vi: "thời gian phục hồi" },
];

// ─────────────────────────────────────────────
// 3. 미용 피부과 (Cosmetic Dermatology)
// ─────────────────────────────────────────────
export const COSMETIC_DERMATOLOGY = [
  // 보톡스 / 필러
  { ko: "보톡스", en: "botulinum toxin injection (Botox)", zh: "肉毒杆菌注射（保妥适）", ja: "ボトックス注射", vi: "tiêm botox" },
  { ko: "필러", en: "dermal filler (hyaluronic acid filler)", zh: "玻尿酸填充", ja: "ヒアルロン酸フィラー", vi: "tiêm filler" },
  { ko: "윤곽주사", en: "facial contouring injection (Botox for jaw/calf)", zh: "轮廓针", ja: "輪郭注射", vi: "tiêm thu nhỏ cơ" },
  { ko: "필러 용해", en: "filler dissolution / hyaluronidase injection", zh: "溶解玻尿酸", ja: "フィラー溶解", vi: "tan filler" },
  { ko: "콧대 필러", en: "nose bridge filler", zh: "鼻梁填充", ja: "鼻フィラー", vi: "tiêm filler sống mũi" },
  { ko: "턱선 필러", en: "jawline filler", zh: "下颌线填充", ja: "顎ラインフィラー", vi: "tiêm filler đường hàm" },
  { ko: "눈밑 필러", en: "under-eye filler / tear trough filler", zh: "泪沟填充", ja: "涙袋フィラー", vi: "tiêm filler vùng mắt trũng" },
  { ko: "입술 필러", en: "lip filler / lip augmentation", zh: "嘴唇填充", ja: "リップフィラー", vi: "tiêm filler môi" },

  // 레이저
  { ko: "레이저 토닝", en: "laser toning (low-fluence Nd:YAG)", zh: "激光嫩肤", ja: "レーザートーニング", vi: "laser toning" },
  { ko: "피코 레이저", en: "picosecond laser (PicoSure / PicoPlus)", zh: "皮秒激光", ja: "ピコレーザー", vi: "laser picosecond" },
  { ko: "프락셀", en: "fractional laser (Fraxel)", zh: "飞顿激光", ja: "フラクセル", vi: "laser phân đoạn" },
  { ko: "탄산가스 레이저", en: "CO2 laser", zh: "二氧化碳激光", ja: "炭酸ガスレーザー", vi: "laser CO2" },
  { ko: "IPL", en: "intense pulsed light (IPL)", zh: "强脉冲光（光子嫩肤）", ja: "IPL光治療", vi: "ánh sáng xung mạnh (IPL)" },
  { ko: "색소 레이저", en: "pigment laser", zh: "色素激光", ja: "色素レーザー", vi: "laser sắc tố" },
  { ko: "혈관 레이저", en: "vascular laser", zh: "血管激光", ja: "血管レーザー", vi: "laser mạch máu" },
  { ko: "레이저 제모", en: "laser hair removal", zh: "激光脱毛", ja: "レーザー脱毛", vi: "triệt lông bằng laser" },
  { ko: "레이저 문신제거", en: "laser tattoo removal", zh: "激光文身去除", ja: "レーザー刺青除去", vi: "xóa xăm bằng laser" },

  // 피부 시술
  { ko: "울쎄라", en: "Ultherapy (HIFU)", zh: "超声刀", ja: "ウルセラ（HIFU）", vi: "Ultherapy / HIFU" },
  { ko: "써마지", en: "Thermage (RF skin tightening)", zh: "热玛吉", ja: "サーマジ", vi: "Thermage (làm săn chắc da)" },
  { ko: "리쥬란", en: "Rejuran healer (PDRN injection)", zh: "婴儿针（PDRN）", ja: "リジュラン注射", vi: "tiêm Rejuran" },
  { ko: "스킨부스터", en: "skin booster (Restylane / Juvederm Volite)", zh: "水光注射", ja: "スキンブースター", vi: "tiêm dưỡng ẩm sâu" },
  { ko: "물광 주사", en: "aqua shine injection / meso injection", zh: "水光针", ja: "水光注射", vi: "tiêm thủy quang" },
  { ko: "PRP 시술", en: "PRP (platelet-rich plasma) therapy", zh: "富血小板血浆（PRP）", ja: "PRP療法", vi: "liệu pháp PRP" },
  { ko: "엑소좀", en: "exosome therapy", zh: "外泌体疗法", ja: "エクソソーム療法", vi: "liệu pháp exosome" },
  { ko: "화학박피", en: "chemical peel", zh: "化学换肤", ja: "ケミカルピーリング", vi: "peel da hóa học" },
  { ko: "마이크로니들링", en: "microneedling (dermaroller)", zh: "微针治疗", ja: "マイクロニードリング", vi: "lăn kim" },

  // 피부 상태
  { ko: "색소침착", en: "hyperpigmentation", zh: "色素沉着", ja: "色素沈着", vi: "tăng sắc tố da" },
  { ko: "기미", en: "melasma / chloasma", zh: "黄褐斑", ja: "肝斑", vi: "nám da" },
  { ko: "잡티", en: "dark spots / age spots", zh: "雀斑/色斑", ja: "シミ", vi: "đốm nâu / tàn nhang" },
  { ko: "여드름", en: "acne (acne vulgaris)", zh: "痤疮（青春痘）", ja: "ニキビ", vi: "mụn trứng cá" },
  { ko: "여드름 흉터", en: "acne scar", zh: "痘疤", ja: "ニキビ跡", vi: "sẹo mụn" },
  { ko: "모공", en: "pore", zh: "毛孔", ja: "毛穴", vi: "lỗ chân lông" },
  { ko: "주름", en: "wrinkle / rhytide", zh: "皱纹", ja: "しわ", vi: "nếp nhăn" },
  { ko: "피부 탄력", en: "skin elasticity", zh: "皮肤弹性", ja: "肌の弾力", vi: "độ đàn hồi da" },
  { ko: "홍조", en: "redness / facial redness", zh: "红脸（潮红）", ja: "赤ら顔", vi: "đỏ mặt" },
  { ko: "로사세아", en: "rosacea", zh: "玫瑰痤疮", ja: "酒さ", vi: "rosacea" },
  { ko: "건성 피부", en: "dry skin", zh: "干性皮肤", ja: "乾燥肌", vi: "da khô" },
  { ko: "지성 피부", en: "oily skin", zh: "油性皮肤", ja: "脂性肌", vi: "da dầu" },
  { ko: "복합성 피부", en: "combination skin", zh: "混合性皮肤", ja: "混合肌", vi: "da hỗn hợp" },
  { ko: "민감성 피부", en: "sensitive skin", zh: "敏感性皮肤", ja: "敏感肌", vi: "da nhạy cảm" },
];

// ─────────────────────────────────────────────
// 4. 내과 (Internal Medicine)
// ─────────────────────────────────────────────
export const INTERNAL_MEDICINE = [
  { ko: "고혈압", en: "hypertension", zh: "高血压", ja: "高血圧", vi: "tăng huyết áp" },
  { ko: "당뇨병", en: "diabetes mellitus", zh: "糖尿病", ja: "糖尿病", vi: "bệnh tiểu đường" },
  { ko: "고지혈증", en: "hyperlipidemia / dyslipidemia", zh: "高脂血症", ja: "高脂血症", vi: "rối loạn lipid máu" },
  { ko: "갑상선 기능항진증", en: "hyperthyroidism", zh: "甲状腺功能亢进", ja: "甲状腺機能亢進症", vi: "cường giáp" },
  { ko: "갑상선 기능저하증", en: "hypothyroidism", zh: "甲状腺功能减退", ja: "甲状腺機能低下症", vi: "suy giáp" },
  { ko: "빈혈", en: "anemia", zh: "贫血", ja: "貧血", vi: "thiếu máu" },
  { ko: "위염", en: "gastritis", zh: "胃炎", ja: "胃炎", vi: "viêm dạ dày" },
  { ko: "위궤양", en: "gastric ulcer / peptic ulcer", zh: "胃溃疡", ja: "胃潰瘍", vi: "loét dạ dày" },
  { ko: "역류성 식도염", en: "gastroesophageal reflux disease (GERD)", zh: "胃食管反流病", ja: "逆流性食道炎", vi: "trào ngược dạ dày" },
  { ko: "대장염", en: "colitis", zh: "结肠炎", ja: "大腸炎", vi: "viêm đại tràng" },
  { ko: "간염", en: "hepatitis", zh: "肝炎", ja: "肝炎", vi: "viêm gan" },
  { ko: "간경변", en: "liver cirrhosis", zh: "肝硬化", ja: "肝硬変", vi: "xơ gan" },
  { ko: "신부전", en: "renal failure / kidney failure", zh: "肾功能衰竭", ja: "腎不全", vi: "suy thận" },
  { ko: "폐렴", en: "pneumonia", zh: "肺炎", ja: "肺炎", vi: "viêm phổi" },
  { ko: "천식", en: "asthma", zh: "哮喘", ja: "ぜんそく", vi: "hen suyễn" },
  { ko: "만성폐쇄성폐질환", en: "COPD (chronic obstructive pulmonary disease)", zh: "慢性阻塞性肺病", ja: "慢性閉塞性肺疾患（COPD）", vi: "bệnh phổi tắc nghẽn mạn tính (COPD)" },
  { ko: "심부전", en: "heart failure", zh: "心力衰竭", ja: "心不全", vi: "suy tim" },
  { ko: "협심증", en: "angina pectoris", zh: "心绞痛", ja: "狭心症", vi: "đau thắt ngực" },
  { ko: "심근경색", en: "myocardial infarction (heart attack)", zh: "心肌梗塞", ja: "心筋梗塞", vi: "nhồi máu cơ tim" },
  { ko: "부정맥", en: "arrhythmia", zh: "心律不齐", ja: "不整脈", vi: "rối loạn nhịp tim" },
];

// ─────────────────────────────────────────────
// 5. 외과 (Surgery)
// ─────────────────────────────────────────────
export const SURGERY = [
  { ko: "맹장염", en: "appendicitis", zh: "阑尾炎", ja: "虫垂炎", vi: "viêm ruột thừa" },
  { ko: "담낭염", en: "cholecystitis", zh: "胆囊炎", ja: "胆嚢炎", vi: "viêm túi mật" },
  { ko: "담석증", en: "cholelithiasis / gallstones", zh: "胆石症", ja: "胆石症", vi: "sỏi mật" },
  { ko: "탈장", en: "hernia", zh: "疝气", ja: "ヘルニア", vi: "thoát vị" },
  { ko: "치질", en: "hemorrhoids", zh: "痔疮", ja: "痔", vi: "trĩ" },
  { ko: "유방절제술", en: "mastectomy", zh: "乳腺切除术", ja: "乳房切除術", vi: "cắt bỏ tuyến vú" },
  { ko: "복강경 수술", en: "laparoscopic surgery", zh: "腹腔镜手术", ja: "腹腔鏡手術", vi: "phẫu thuật nội soi ổ bụng" },
  { ko: "개복수술", en: "open abdominal surgery / laparotomy", zh: "开腹手术", ja: "開腹手術", vi: "phẫu thuật mổ mở" },
  { ko: "봉합사", en: "suture material", zh: "缝合线", ja: "縫合糸", vi: "chỉ khâu" },
  { ko: "배액관", en: "drainage tube / drain", zh: "引流管", ja: "ドレーン", vi: "ống dẫn lưu" },
  { ko: "조직검사", en: "biopsy", zh: "活检", ja: "生検", vi: "sinh thiết" },
  { ko: "절제술", en: "resection / excision", zh: "切除术", ja: "切除術", vi: "phẫu thuật cắt bỏ" },
];

// ─────────────────────────────────────────────
// 6. 응급의학과 (Emergency Medicine)
// ─────────────────────────────────────────────
export const EMERGENCY_MEDICINE = [
  { ko: "의식 없음", en: "unconscious / unresponsive", zh: "失去意识", ja: "意識なし", vi: "mất ý thức" },
  { ko: "심정지", en: "cardiac arrest", zh: "心脏骤停", ja: "心停止", vi: "ngừng tim" },
  { ko: "CPR (심폐소생술)", en: "cardiopulmonary resuscitation (CPR)", zh: "心肺复苏（CPR）", ja: "心肺蘇生（CPR）", vi: "hồi sinh tim phổi (CPR)" },
  { ko: "호흡곤란", en: "dyspnea / shortness of breath", zh: "呼吸困难", ja: "呼吸困難", vi: "khó thở" },
  { ko: "경련", en: "seizure / convulsion", zh: "癫痫发作", ja: "痙攣", vi: "co giật" },
  { ko: "뇌졸중", en: "stroke (CVA)", zh: "脑卒中", ja: "脳卒中", vi: "đột quỵ" },
  { ko: "골절", en: "fracture", zh: "骨折", ja: "骨折", vi: "gãy xương" },
  { ko: "탈구", en: "dislocation", zh: "脱臼", ja: "脱臼", vi: "trật khớp" },
  { ko: "열상", en: "laceration", zh: "撕裂伤", ja: "裂傷", vi: "vết rách" },
  { ko: "화상", en: "burn", zh: "烧伤", ja: "やけど", vi: "bỏng" },
  { ko: "중독", en: "poisoning / intoxication", zh: "中毒", ja: "中毒", vi: "ngộ độc" },
  { ko: "쇼크", en: "shock", zh: "休克", ja: "ショック", vi: "sốc" },
  { ko: "저혈당", en: "hypoglycemia", zh: "低血糖", ja: "低血糖", vi: "hạ đường huyết" },
  { ko: "과호흡", en: "hyperventilation", zh: "过度换气", ja: "過呼吸", vi: "thở quá mức" },
  { ko: "기도확보", en: "airway management", zh: "气道管理", ja: "気道確保", vi: "kiểm soát đường thở" },
];

// ─────────────────────────────────────────────
// 7. 산부인과 (OB/GYN)
// ─────────────────────────────────────────────
export const OBGYN = [
  { ko: "임신", en: "pregnancy", zh: "怀孕", ja: "妊娠", vi: "mang thai" },
  { ko: "출산", en: "delivery / childbirth", zh: "分娩", ja: "出産", vi: "sinh con" },
  { ko: "자연분만", en: "vaginal delivery / natural birth", zh: "顺产", ja: "自然分娩", vi: "sinh thường" },
  { ko: "제왕절개", en: "cesarean section (C-section)", zh: "剖腹产", ja: "帝王切開", vi: "sinh mổ" },
  { ko: "유산", en: "miscarriage / spontaneous abortion", zh: "流产", ja: "流産", vi: "sảy thai" },
  { ko: "자궁경부암", en: "cervical cancer", zh: "宫颈癌", ja: "子宮頸がん", vi: "ung thư cổ tử cung" },
  { ko: "자궁근종", en: "uterine fibroid / myoma", zh: "子宫肌瘤", ja: "子宮筋腫", vi: "u xơ tử cung" },
  { ko: "난소낭종", en: "ovarian cyst", zh: "卵巢囊肿", ja: "卵巣嚢腫", vi: "u nang buồng trứng" },
  { ko: "월경불순", en: "irregular menstruation / menstrual irregularity", zh: "月经不调", ja: "月経不順", vi: "rối loạn kinh nguyệt" },
  { ko: "폐경", en: "menopause", zh: "绝经（更年期）", ja: "閉経", vi: "mãn kinh" },
  { ko: "피임", en: "contraception", zh: "避孕", ja: "避妊", vi: "tránh thai" },
  { ko: "초음파 검사", en: "ultrasound examination (USG)", zh: "超声波检查", ja: "超音波検査", vi: "siêu âm" },
];

// ─────────────────────────────────────────────
// 8. 소아과 (Pediatrics)
// ─────────────────────────────────────────────
export const PEDIATRICS = [
  { ko: "예방접종", en: "vaccination / immunization", zh: "预防接种", ja: "予防接種", vi: "tiêm chủng" },
  { ko: "성장 발달", en: "growth and development", zh: "生长发育", ja: "成長発達", vi: "tăng trưởng và phát triển" },
  { ko: "소아 발열", en: "pediatric fever", zh: "小儿发烧", ja: "小児発熱", vi: "sốt trẻ em" },
  { ko: "열성경련", en: "febrile seizure", zh: "热性惊厥", ja: "熱性けいれん", vi: "co giật do sốt cao" },
  { ko: "수족구병", en: "hand, foot, and mouth disease (HFMD)", zh: "手足口病", ja: "手足口病", vi: "bệnh tay chân miệng" },
  { ko: "아토피 피부염", en: "atopic dermatitis / eczema", zh: "特应性皮炎", ja: "アトピー性皮膚炎", vi: "viêm da dị ứng (chàm)" },
  { ko: "중이염", en: "otitis media", zh: "中耳炎", ja: "中耳炎", vi: "viêm tai giữa" },
  { ko: "편도선염", en: "tonsillitis", zh: "扁桃腺炎", ja: "扁桃炎", vi: "viêm amidan" },
  { ko: "로타바이러스", en: "rotavirus", zh: "轮状病毒", ja: "ロタウイルス", vi: "virus rota" },
  { ko: "모유수유", en: "breastfeeding", zh: "母乳喂养", ja: "母乳育児", vi: "cho con bú" },
];

// ─────────────────────────────────────────────
// 9. 정형외과 (Orthopedics)
// ─────────────────────────────────────────────
export const ORTHOPEDICS = [
  { ko: "디스크", en: "herniated disc / intervertebral disc disease", zh: "椎间盘突出", ja: "椎間板ヘルニア", vi: "thoát vị đĩa đệm" },
  { ko: "척추측만증", en: "scoliosis", zh: "脊柱侧弯", ja: "脊柱側弯症", vi: "vẹo cột sống" },
  { ko: "관절염", en: "arthritis", zh: "关节炎", ja: "関節炎", vi: "viêm khớp" },
  { ko: "무릎 인공관절", en: "total knee replacement (TKR)", zh: "全膝关节置换术", ja: "人工膝関節置換術", vi: "thay khớp gối toàn phần" },
  { ko: "회전근개 파열", en: "rotator cuff tear", zh: "肩袖撕裂", ja: "回旋筋腱板断裂", vi: "rách vòng bít cơ" },
  { ko: "십자인대 파열", en: "ACL tear (anterior cruciate ligament)", zh: "前交叉韧带撕裂", ja: "前十字靭帯断裂", vi: "đứt dây chằng chéo trước" },
  { ko: "골다공증", en: "osteoporosis", zh: "骨质疏松", ja: "骨粗鬆症", vi: "loãng xương" },
  { ko: "석고 고정", en: "cast immobilization", zh: "石膏固定", ja: "ギプス固定", vi: "bó bột" },
  { ko: "물리치료", en: "physical therapy / physiotherapy", zh: "物理治疗", ja: "理学療法", vi: "vật lý trị liệu" },
  { ko: "관절내시경", en: "arthroscopy", zh: "关节镜手术", ja: "関節鏡手術", vi: "nội soi khớp" },
];

// ─────────────────────────────────────────────
// 10. 신경과 / 신경외과 (Neurology / Neurosurgery)
// ─────────────────────────────────────────────
export const NEUROLOGY = [
  { ko: "두통", en: "headache", zh: "头痛", ja: "頭痛", vi: "đau đầu" },
  { ko: "편두통", en: "migraine", zh: "偏头痛", ja: "片頭痛", vi: "đau nửa đầu" },
  { ko: "어지럼증", en: "dizziness / vertigo", zh: "眩晕", ja: "めまい", vi: "chóng mặt" },
  { ko: "파킨슨병", en: "Parkinson's disease", zh: "帕金森病", ja: "パーキンソン病", vi: "bệnh Parkinson" },
  { ko: "치매", en: "dementia", zh: "痴呆", ja: "認知症", vi: "sa sút trí tuệ / mất trí nhớ" },
  { ko: "간질 (뇌전증)", en: "epilepsy", zh: "癫痫", ja: "てんかん", vi: "động kinh" },
  { ko: "뇌종양", en: "brain tumor", zh: "脑肿瘤", ja: "脳腫瘍", vi: "u não" },
  { ko: "뇌경색", en: "cerebral infarction / ischemic stroke", zh: "脑梗死", ja: "脳梗塞", vi: "nhồi máu não" },
  { ko: "뇌출혈", en: "cerebral hemorrhage", zh: "脑出血", ja: "脳出血", vi: "xuất huyết não" },
  { ko: "MRI 검사", en: "MRI (magnetic resonance imaging)", zh: "磁共振检查（MRI）", ja: "MRI検査", vi: "chụp cộng hưởng từ (MRI)" },
  { ko: "CT 검사", en: "CT scan (computed tomography)", zh: "CT检查", ja: "CT検査", vi: "chụp cắt lớp vi tính (CT)" },
];

// ─────────────────────────────────────────────
// 11. 안과 (Ophthalmology)
// ─────────────────────────────────────────────
export const OPHTHALMOLOGY = [
  { ko: "라식", en: "LASIK (laser in situ keratomileusis)", zh: "准分子激光（LASIK）", ja: "レーシック", vi: "phẫu thuật LASIK" },
  { ko: "라섹", en: "LASEK (laser epithelial keratomileusis)", zh: "LASEK近视手术", ja: "ラセック", vi: "phẫu thuật LASEK" },
  { ko: "백내장", en: "cataract", zh: "白内障", ja: "白内障", vi: "đục thủy tinh thể" },
  { ko: "녹내장", en: "glaucoma", zh: "青光眼", ja: "緑内障", vi: "tăng nhãn áp" },
  { ko: "황반변성", en: "macular degeneration (AMD)", zh: "黄斑变性", ja: "黄斑変性", vi: "thoái hóa điểm vàng" },
  { ko: "근시", en: "myopia / nearsightedness", zh: "近视", ja: "近視", vi: "cận thị" },
  { ko: "원시", en: "hyperopia / farsightedness", zh: "远视", ja: "遠視", vi: "viễn thị" },
  { ko: "난시", en: "astigmatism", zh: "散光", ja: "乱視", vi: "loạn thị" },
  { ko: "안압", en: "intraocular pressure (IOP)", zh: "眼压", ja: "眼圧", vi: "nhãn áp" },
  { ko: "시력 검사", en: "visual acuity test", zh: "视力检查", ja: "視力検査", vi: "kiểm tra thị lực" },
];

// ─────────────────────────────────────────────
// 12. 이비인후과 (ENT - Ear, Nose, Throat)
// ─────────────────────────────────────────────
export const ENT = [
  { ko: "축농증", en: "sinusitis", zh: "鼻窦炎", ja: "副鼻腔炎", vi: "viêm xoang" },
  { ko: "비염", en: "rhinitis", zh: "鼻炎", ja: "鼻炎", vi: "viêm mũi" },
  { ko: "알레르기 비염", en: "allergic rhinitis", zh: "过敏性鼻炎", ja: "アレルギー性鼻炎", vi: "viêm mũi dị ứng" },
  { ko: "후두염", en: "laryngitis", zh: "喉炎", ja: "喉頭炎", vi: "viêm thanh quản" },
  { ko: "이명", en: "tinnitus", zh: "耳鸣", ja: "耳鳴り", vi: "ù tai" },
  { ko: "난청", en: "hearing loss", zh: "听力下降", ja: "難聴", vi: "giảm thính lực" },
  { ko: "코막힘", en: "nasal congestion", zh: "鼻塞", ja: "鼻づまり", vi: "ngạt mũi" },
  { ko: "코피", en: "nosebleed / epistaxis", zh: "鼻出血", ja: "鼻血", vi: "chảy máu mũi" },
];

// ─────────────────────────────────────────────
// 13. 검사 / 처치 공통
// ─────────────────────────────────────────────
export const PROCEDURES_AND_TESTS = [
  { ko: "혈액 검사", en: "blood test / CBC", zh: "血液检查", ja: "血液検査", vi: "xét nghiệm máu" },
  { ko: "소변 검사", en: "urinalysis", zh: "尿液检查", ja: "尿検査", vi: "xét nghiệm nước tiểu" },
  { ko: "흉부 X선", en: "chest X-ray", zh: "胸部X光", ja: "胸部レントゲン", vi: "X-quang ngực" },
  { ko: "심전도", en: "electrocardiogram (ECG/EKG)", zh: "心电图", ja: "心電図", vi: "điện tâm đồ (ECG)" },
  { ko: "내시경", en: "endoscopy", zh: "内镜检查", ja: "内視鏡", vi: "nội soi" },
  { ko: "대장내시경", en: "colonoscopy", zh: "结肠镜", ja: "大腸内視鏡", vi: "nội soi đại tràng" },
  { ko: "위내시경", en: "gastroscopy / upper GI endoscopy", zh: "胃镜检查", ja: "胃カメラ", vi: "nội soi dạ dày" },
  { ko: "초음파", en: "ultrasound (USG)", zh: "超声波", ja: "超音波検査", vi: "siêu âm" },
  { ko: "골밀도 검사", en: "bone density test (DEXA scan)", zh: "骨密度检查", ja: "骨密度検査", vi: "đo mật độ xương" },
  { ko: "알레르기 검사", en: "allergy test", zh: "过敏测试", ja: "アレルギー検査", vi: "xét nghiệm dị ứng" },
  { ko: "수면다원검사", en: "polysomnography / sleep study", zh: "多导睡眠监测", ja: "睡眠ポリグラフ検査", vi: "đa ký giấc ngủ" },
  { ko: "내시경 조직검사", en: "endoscopic biopsy", zh: "内镜活检", ja: "内視鏡生検", vi: "sinh thiết nội soi" },
];

// ─────────────────────────────────────────────
// 14. 약물 / 처방 공통
// ─────────────────────────────────────────────
export const MEDICATIONS = [
  { ko: "진통제", en: "analgesic / painkiller", zh: "镇痛药", ja: "鎮痛剤", vi: "thuốc giảm đau" },
  { ko: "소염제", en: "anti-inflammatory drug (NSAID)", zh: "消炎药", ja: "消炎剤", vi: "thuốc kháng viêm" },
  { ko: "항생제", en: "antibiotic", zh: "抗生素", ja: "抗生物質", vi: "kháng sinh" },
  { ko: "스테로이드", en: "corticosteroid / steroid", zh: "类固醇", ja: "ステロイド", vi: "corticoid" },
  { ko: "혈압약", en: "antihypertensive medication", zh: "降压药", ja: "降圧剤", vi: "thuốc huyết áp" },
  { ko: "혈당약", en: "antidiabetic medication", zh: "降糖药", ja: "血糖降下薬", vi: "thuốc tiểu đường" },
  { ko: "수면제", en: "sleeping pill / hypnotic", zh: "安眠药", ja: "睡眠薬", vi: "thuốc ngủ" },
  { ko: "항히스타민제", en: "antihistamine", zh: "抗组胺药", ja: "抗ヒスタミン剤", vi: "thuốc kháng histamine" },
  { ko: "위장약", en: "antacid / gastrointestinal medication", zh: "胃肠药", ja: "胃腸薬", vi: "thuốc dạ dày" },
  { ko: "링거액", en: "Ringer's solution / IV saline", zh: "林格液 / 生理盐水", ja: "リンゲル液", vi: "dung dịch Ringer / nước muối sinh lý" },
  { ko: "국소 마취제", en: "local anesthetic (lidocaine)", zh: "局部麻醉药（利多卡因）", ja: "局所麻酔薬（リドカイン）", vi: "thuốc tê tại chỗ (lidocaine)" },
  { ko: "항응고제", en: "anticoagulant (heparin / warfarin)", zh: "抗凝血药", ja: "抗凝固薬", vi: "thuốc chống đông máu" },
];

// ─────────────────────────────────────────────
// SYSTEM PROMPT GENERATOR
// dept 파라미터에 따라 관련 용어를 자동 추출 → GPT-4o systemPrompt에 주입
// ─────────────────────────────────────────────

const DEPT_TERM_MAP = {
  plastic_surgery:      [COMMON_HOSPITAL, PLASTIC_SURGERY, COSMETIC_DERMATOLOGY, MEDICATIONS],
  dermatology:          [COMMON_HOSPITAL, COSMETIC_DERMATOLOGY, PLASTIC_SURGERY, MEDICATIONS],
  internal_medicine:    [COMMON_HOSPITAL, INTERNAL_MEDICINE, PROCEDURES_AND_TESTS, MEDICATIONS],
  internal:             [COMMON_HOSPITAL, INTERNAL_MEDICINE, PROCEDURES_AND_TESTS, MEDICATIONS],
  surgery:              [COMMON_HOSPITAL, SURGERY, PROCEDURES_AND_TESTS, MEDICATIONS],
  emergency:            [COMMON_HOSPITAL, EMERGENCY_MEDICINE, PROCEDURES_AND_TESTS, MEDICATIONS],
  obgyn:                [COMMON_HOSPITAL, OBGYN, PROCEDURES_AND_TESTS, MEDICATIONS],
  obstetrics:           [COMMON_HOSPITAL, OBGYN, PROCEDURES_AND_TESTS, MEDICATIONS],
  pediatrics:           [COMMON_HOSPITAL, PEDIATRICS, PROCEDURES_AND_TESTS, MEDICATIONS],
  orthopedics:          [COMMON_HOSPITAL, ORTHOPEDICS, PROCEDURES_AND_TESTS, MEDICATIONS],
  neurology:            [COMMON_HOSPITAL, NEUROLOGY, PROCEDURES_AND_TESTS, MEDICATIONS],
  ophthalmology:        [COMMON_HOSPITAL, OPHTHALMOLOGY, PROCEDURES_AND_TESTS, MEDICATIONS],
  ent:                  [COMMON_HOSPITAL, ENT, PROCEDURES_AND_TESTS, MEDICATIONS],
  reception:            [COMMON_HOSPITAL, PROCEDURES_AND_TESTS, MEDICATIONS],
};

/**
 * 과별 용어집을 시스템 프롬프트용 텍스트로 변환
 * @param {string} dept - 진료과 코드
 * @param {string} targetLang - 번역 대상 언어 ('en'|'zh'|'ja'|'vi')
 * @returns {string} systemPrompt에 삽입할 용어집 텍스트
 */
export function getMedicalTermContext(dept = 'reception', targetLang = 'en') {
  const termSets = DEPT_TERM_MAP[dept] || DEPT_TERM_MAP['reception'];
  const allTerms = termSets.flat();

  const lines = allTerms.map(term => {
    const target = term[targetLang] || term['en'];
    return `- ${term.ko} = ${target}`;
  });

  return `
[전문 의료 통역 지침]
당신은 병원 전문 의료통역사입니다.
아래 용어집을 최우선으로 참조하여 정확하게 번역하세요.
의학 용어는 아래 표준 번역어를 반드시 사용하세요.

[${dept.toUpperCase()} 과 전문용어]
${lines.join('\n')}

번역 원칙:
1. 의학 용어는 위 용어집 기준을 우선 적용
2. 용어집에 없는 경우 의학적으로 가장 정확한 표현 사용
3. 환자가 이해하기 쉬운 자연스러운 표현으로 번역
4. 약품명, 시술명, 검사명은 정확하게 유지
`.trim();
}

export default {
  COMMON_HOSPITAL,
  PLASTIC_SURGERY,
  COSMETIC_DERMATOLOGY,
  INTERNAL_MEDICINE,
  SURGERY,
  EMERGENCY_MEDICINE,
  OBGYN,
  PEDIATRICS,
  ORTHOPEDICS,
  NEUROLOGY,
  OPHTHALMOLOGY,
  ENT,
  PROCEDURES_AND_TESTS,
  MEDICATIONS,
  getMedicalTermContext,
};
