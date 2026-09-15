import { DomainRuleError } from "@/domains/errors";

export const labStatuses = ["DRAFT", "SENT", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"] as const;
export type LabStatus = (typeof labStatuses)[number];

const transitions: Record<LabStatus, LabStatus[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function assertLabTransition(from: string, to: string): asserts to is LabStatus {
  if (!labStatuses.includes(from as LabStatus) || !labStatuses.includes(to as LabStatus)) {
    throw new DomainRuleError("lab-status-invalid");
  }
  if (from !== to && !transitions[from as LabStatus].includes(to as LabStatus)) {
    throw new DomainRuleError("lab-status-transition-invalid");
  }
}
