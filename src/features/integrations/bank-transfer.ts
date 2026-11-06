export type BankTransferSettings = {
  clinics: { id: string; name: string }[];
  canManageOrganization: boolean;
  isDemo: boolean;
  connections: { clinicId: string | null; configured: boolean; enabled: boolean; updatedAt: string }[];
};
export type BankTransferInstructions = {
  payload: string;
  bankBin: string;
  accountNumber: string;
  recipientName: string;
  amount: number;
  balance: number;
  memo: string;
  generatedAt: string;
  bankAccountVerified: false;
};
