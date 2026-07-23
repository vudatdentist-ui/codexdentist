export type Clinic = {
  id: string;
  chainId?: string | null;
  chainName?: string | null;
  name: string;
  city: string;
  chairs: number;
  doctors: number;
  todayVisits: number;
  utilization: number;
  production: number;
  collection: number;
  pendingClaims: number;
  active?: boolean;
};

export type Appointment = {
  id: string;
  time: string;
  patient: string;
  patientId: string;
  clinicId: string;
  provider: string;
  room: string;
  procedure: string;
  status:
    | "Requested"
    | "Confirmed"
    | "Arrived"
    | "In chair"
    | "Completed"
    | "Needs follow-up"
    | "Cancelled"
    | "No-show";
  duration: number;
  providerId?: string;
  chairId?: string | null;
  startsAt?: string;
  endsAt?: string;
};

export type Patient = {
  id: string;
  patientCode?: string;
  name: string;
  age: number;
  phone: string;
  email?: string | null;
  gender?: string | null;
  visitReason?: string | null;
  leadSource?: string | null;
  city: string;
  clinicId: string;
  dateOfBirth?: string | null;
  guardianName?: string | null;
  address?: string | null;
  nationalId?: string | null;
  nextVisit: string;
  lastVisit: string;
  balance: number;
  consent: "Granted" | "Needs renewal" | "Partial";
  consentVersion?: string | null;
  consentSignedAt?: string | null;
  consentHistory?: Array<{
    id: string;
    status: "Granted" | "Needs renewal" | "Partial";
    version: string;
    signedAt: string | null;
    recordedAt: string;
    channel: string;
  }>;
  flags: string[];
  treatmentProgress: number;
};

export type TreatmentPlan = {
  id: string;
  patient: string;
  patientId?: string;
  clinicId: string;
  title: string;
  phase: string;
  status:
    | "Draft"
    | "Presented"
    | "Accepted"
    | "In progress"
    | "Completed"
    | "Declined";
  estimatedCost: number;
  patientShare: number;
  tasks: string[];
  createdAt?: string;
};

export type Invoice = {
  id: string;
  patient: string;
  patientId?: string;
  clinicId: string;
  amount: number;
  paidAmount?: number;
  status: "Draft" | "Paid" | "Open" | "Partial" | "Overdue" | "Claim pending" | "Void";
  due: string;
  serviceId?: string;
  serviceCode?: string;
  receiptId?: string;
  creditAllocationId?: string;
  issuedAtMs?: number;
};

export type CommunityPost = {
  id: string;
  type: "Announcement" | "Case discussion" | "Shift handoff" | "Training" | "Policy";
  author: string;
  clinic: string;
  clinicId?: string | null;
  title: string;
  body: string;
  tags: string[];
  replies: number;
  createdAt?: string;
};

export const clinics: Clinic[] = [
  {
    id: "hcm-q1",
    chainId: "demo-dental-chain",
    chainName: "CodexMed Dental",
    name: "Saigon District 1",
    city: "Ho Chi Minh City",
    chairs: 8,
    doctors: 11,
    todayVisits: 64,
    utilization: 86,
    production: 284000000,
    collection: 221000000,
    pendingClaims: 18,
  },
  {
    id: "hn-tayho",
    chainId: "demo-dental-chain",
    chainName: "CodexMed Dental",
    name: "Ha Noi Tay Ho",
    city: "Ha Noi",
    chairs: 6,
    doctors: 8,
    todayVisits: 43,
    utilization: 78,
    production: 176000000,
    collection: 149000000,
    pendingClaims: 11,
  },
  {
    id: "dn-haichau",
    chainId: "demo-dental-chain",
    chainName: "CodexMed Dental",
    name: "Da Nang Hai Chau",
    city: "Da Nang",
    chairs: 5,
    doctors: 6,
    todayVisits: 31,
    utilization: 72,
    production: 119000000,
    collection: 101000000,
    pendingClaims: 7,
  },
  {
    id: "ct-ninhkieu",
    chainId: "demo-dental-chain",
    chainName: "CodexMed Dental",
    name: "Can Tho Ninh Kieu",
    city: "Can Tho",
    chairs: 4,
    doctors: 5,
    todayVisits: 26,
    utilization: 69,
    production: 87000000,
    collection: 76000000,
    pendingClaims: 4,
  },
];

export const appointments: Appointment[] = [
  {
    id: "a1",
    time: "08:00",
    patient: "Nguyen Minh Anh",
    patientId: "p1",
    clinicId: "hcm-q1",
    provider: "Dr. Linh Tran",
    room: "Chair 2",
    procedure: "Implant consult",
    status: "In chair",
    duration: 60,
  },
  {
    id: "a2",
    time: "09:30",
    patient: "Pham Quoc Bao",
    patientId: "p2",
    clinicId: "hcm-q1",
    provider: "Dr. Khanh Do",
    room: "Chair 5",
    procedure: "Crown prep",
    status: "Arrived",
    duration: 90,
  },
  {
    id: "a3",
    time: "10:15",
    patient: "Le Hoang Vy",
    patientId: "p3",
    clinicId: "hn-tayho",
    provider: "Dr. Thao Nguyen",
    room: "Chair 1",
    procedure: "Ortho adjustment",
    status: "Confirmed",
    duration: 30,
  },
  {
    id: "a4",
    time: "11:00",
    patient: "Do Gia Han",
    patientId: "p4",
    clinicId: "dn-haichau",
    provider: "Dr. Nam Phan",
    room: "Chair 3",
    procedure: "Pediatric cleaning",
    status: "Completed",
    duration: 45,
  },
  {
    id: "a5",
    time: "13:30",
    patient: "Tran Bao Chau",
    patientId: "p5",
    clinicId: "ct-ninhkieu",
    provider: "Dr. My Vo",
    room: "Chair 1",
    procedure: "Root canal follow-up",
    status: "Needs follow-up",
    duration: 45,
  },
  {
    id: "a6",
    time: "15:00",
    patient: "Ho Duc Anh",
    patientId: "p6",
    clinicId: "hcm-q1",
    provider: "Dr. Linh Tran",
    room: "Chair 4",
    procedure: "Whitening consult",
    status: "Confirmed",
    duration: 30,
  },
];

export const patients: Patient[] = [
  {
    id: "p1",
    patientCode: "PT000001",
    name: "Nguyen Minh Anh",
    age: 34,
    phone: "+84 90 123 4567",
    city: "Ho Chi Minh City",
    clinicId: "hcm-q1",
    nextVisit: "Today 08:00",
    lastVisit: "2026-03-22",
    balance: 4200000,
    consent: "Granted",
    flags: ["Penicillin allergy", "Implant candidate"],
    treatmentProgress: 62,
  },
  {
    id: "p2",
    patientCode: "PT000002",
    name: "Pham Quoc Bao",
    age: 41,
    phone: "+84 91 778 2201",
    city: "Ho Chi Minh City",
    clinicId: "hcm-q1",
    nextVisit: "Today 09:30",
    lastVisit: "2026-04-04",
    balance: 9800000,
    consent: "Partial",
    flags: ["Crown plan", "Payment plan"],
    treatmentProgress: 34,
  },
  {
    id: "p3",
    patientCode: "PT000003",
    name: "Le Hoang Vy",
    age: 16,
    phone: "+84 98 444 1088",
    city: "Ha Noi",
    clinicId: "hn-tayho",
    nextVisit: "Today 10:15",
    lastVisit: "2026-03-29",
    balance: 1200000,
    consent: "Needs renewal",
    flags: ["Guardian consent", "Ortho"],
    treatmentProgress: 48,
  },
  {
    id: "p4",
    patientCode: "PT000004",
    name: "Do Gia Han",
    age: 8,
    phone: "+84 93 666 4500",
    city: "Da Nang",
    clinicId: "dn-haichau",
    nextVisit: "Today 11:00",
    lastVisit: "2026-04-10",
    balance: 0,
    consent: "Granted",
    flags: ["Pediatric", "Recall in 6 months"],
    treatmentProgress: 88,
  },
  {
    id: "p5",
    patientCode: "PT000005",
    name: "Tran Bao Chau",
    age: 29,
    phone: "+84 94 390 7781",
    city: "Can Tho",
    clinicId: "ct-ninhkieu",
    nextVisit: "Today 13:30",
    lastVisit: "2026-04-01",
    balance: 2500000,
    consent: "Granted",
    flags: ["Endodontics", "Follow-up needed"],
    treatmentProgress: 72,
  },
];

export const treatmentPlans: TreatmentPlan[] = [
  {
    id: "tp1",
    patient: "Nguyen Minh Anh",
    clinicId: "hcm-q1",
    title: "Implant restoration, lower molar",
    phase: "Surgical planning",
    status: "Presented",
    estimatedCost: 39000000,
    patientShare: 39000000,
    tasks: ["CBCT review", "Consent packet", "Deposit invoice"],
  },
  {
    id: "tp2",
    patient: "Pham Quoc Bao",
    clinicId: "hcm-q1",
    title: "Crown and bite stabilization",
    phase: "Preparation",
    status: "In progress",
    estimatedCost: 18000000,
    patientShare: 14200000,
    tasks: ["Temporary crown", "Lab case", "Claim attachment"],
  },
  {
    id: "tp3",
    patient: "Le Hoang Vy",
    clinicId: "hn-tayho",
    title: "Ortho refinement",
    phase: "Month 8",
    status: "Accepted",
    estimatedCost: 28000000,
    patientShare: 9000000,
    tasks: ["Guardian approval", "Aligner pickup", "Photo update"],
  },
  {
    id: "tp4",
    patient: "Tran Bao Chau",
    clinicId: "ct-ninhkieu",
    title: "Endodontic retreatment",
    phase: "Clinical review",
    status: "Draft",
    estimatedCost: 7200000,
    patientShare: 7200000,
    tasks: ["Pain score", "Radiograph", "Finalize quote"],
  },
];

export const invoices: Invoice[] = [
  {
    id: "INV-2304",
    patient: "Pham Quoc Bao",
    clinicId: "hcm-q1",
    amount: 9800000,
    status: "Open",
    due: "2026-04-30",
  },
  {
    id: "INV-2297",
    patient: "Nguyen Minh Anh",
    clinicId: "hcm-q1",
    amount: 4200000,
    status: "Claim pending",
    due: "2026-05-02",
  },
  {
    id: "INV-2288",
    patient: "Tran Bao Chau",
    clinicId: "ct-ninhkieu",
    amount: 2500000,
    status: "Overdue",
    due: "2026-04-18",
  },
  {
    id: "INV-2275",
    patient: "Do Gia Han",
    clinicId: "dn-haichau",
    amount: 850000,
    status: "Paid",
    due: "2026-04-22",
  },
];

export const communityPosts: CommunityPost[] = [
  {
    id: "c1",
    type: "Shift handoff",
    author: "Linh Tran",
    clinic: "Saigon District 1",
    clinicId: "hcm-q1",
    title: "Implant consult queue needs CBCT review",
    body: "Three implant consults are waiting for CBCT sign-off before treatment plan approval.",
    tags: ["implant", "handoff"],
    replies: 6,
  },
  {
    id: "c2",
    type: "Announcement",
    author: "Ops Team",
    clinic: "All clinics",
    clinicId: null,
    title: "Updated consent wording for health data",
    body: "Front desk should use the updated consent script when onboarding new patients.",
    tags: ["privacy", "front desk"],
    replies: 12,
  },
  {
    id: "c3",
    type: "Training",
    author: "Thao Nguyen",
    clinic: "Ha Noi Tay Ho",
    clinicId: "hn-tayho",
    title: "Pediatric recall workflow",
    body: "Sharing the checklist that reduced missed pediatric recall bookings last week.",
    tags: ["training", "recall"],
    replies: 4,
  },
];

export const roles = [
  "Owner",
  "Area manager",
  "Clinic manager",
  "Dentist",
  "Front desk",
  "Billing",
  "Patient",
];

export const formatVnd = (amount: number) =>
  amount.toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  });
