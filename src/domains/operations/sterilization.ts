import { DomainRuleError } from "@/domains/errors";

export const sterilizationStatuses = ["PREPARING", "RUNNING", "PASSED", "FAILED", "RELEASED"] as const;
export type SterilizationStatus = (typeof sterilizationStatuses)[number];

const transitions: Record<SterilizationStatus, SterilizationStatus[]> = {
  PREPARING: ["RUNNING"],
  RUNNING: ["PASSED", "FAILED"],
  PASSED: ["RELEASED"],
  FAILED: [],
  RELEASED: [],
};

export function assertSterilizationTransition(from: string, to: string) {
  if (!sterilizationStatuses.includes(from as SterilizationStatus) || !sterilizationStatuses.includes(to as SterilizationStatus)) {
    throw new DomainRuleError("sterilization-status-invalid");
  }
  if (from !== to && !transitions[from as SterilizationStatus].includes(to as SterilizationStatus)) {
    throw new DomainRuleError("sterilization-status-transition-invalid");
  }
}
