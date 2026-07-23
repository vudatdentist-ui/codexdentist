export type CompensationPool = "DOCTOR" | "ASSISTANT";

export type CompensationRole =
  | "CONSULTANT"
  | "OPERATOR"
  | "CLINICAL_SUPPORT"
  | "ASSISTANT_PRIMARY"
  | "ASSISTANT_SECONDARY";

export type CompensationParticipantSet = {
  consultantId?: string;
  operatorId: string;
  clinicalSupportId?: string;
  assistantPrimaryId?: string;
  assistantSecondaryId?: string;
};

export type ServiceCompensationRuleInput = {
  doctorPoolPercent: number;
  assistantPoolPercent: number;
  doctorShares: {
    consultantPercent: number;
    operatorPercent: number;
    clinicalSupportPercent: number;
  };
  assistantShares: {
    primaryPercent: number;
    secondaryPercent: number;
  };
  fallbackMissingClinicalSupportToOperator: boolean;
  fallbackMissingAssistantSecondaryToPrimary: boolean;
};

export type CompensationCalculationLine = {
  participantId: string;
  pool: CompensationPool;
  role: CompensationRole;
  sharePercent: number;
  amount: number;
  resolvedFromFallback: boolean;
  sourceRole?: CompensationRole;
};

export type ServiceProgressCompensationInput = {
  serviceAmount: number;
  progressDeltaPercent: number;
  participants: CompensationParticipantSet;
  rule?: ServiceCompensationRuleInput;
};

export const defaultServiceCompensationRule: ServiceCompensationRuleInput = {
  doctorPoolPercent: 10,
  assistantPoolPercent: 2,
  doctorShares: {
    consultantPercent: 20,
    operatorPercent: 50,
    clinicalSupportPercent: 30,
  },
  assistantShares: {
    primaryPercent: 70,
    secondaryPercent: 30,
  },
  fallbackMissingClinicalSupportToOperator: true,
  fallbackMissingAssistantSecondaryToPrimary: true,
};

export function calculateServiceProgressCompensation({
  serviceAmount,
  progressDeltaPercent,
  participants,
  rule = defaultServiceCompensationRule,
}: ServiceProgressCompensationInput) {
  const earnedServiceAmount = roundMoney(
    serviceAmount * (progressDeltaPercent / 100),
  );
  const doctorPoolAmount = percentOf(earnedServiceAmount, rule.doctorPoolPercent);
  const assistantPoolAmount = percentOf(
    earnedServiceAmount,
    rule.assistantPoolPercent,
  );
  const lines: CompensationCalculationLine[] = [];
  let unallocatedAmount = 0;

  const addLine = ({
    participantId,
    pool,
    poolAmount,
    role,
    sharePercent,
    resolvedFromFallback = false,
    sourceRole,
  }: {
    participantId?: string;
    pool: CompensationPool;
    poolAmount: number;
    role: CompensationRole;
    sharePercent: number;
    resolvedFromFallback?: boolean;
    sourceRole?: CompensationRole;
  }) => {
    const amount = percentOf(poolAmount, sharePercent);

    if (!participantId) {
      unallocatedAmount += amount;
      return;
    }

    lines.push({
      participantId,
      pool,
      role,
      sharePercent,
      amount,
      resolvedFromFallback,
      sourceRole,
    });
  };

  addLine({
    participantId: participants.consultantId,
    pool: "DOCTOR",
    poolAmount: doctorPoolAmount,
    role: "CONSULTANT",
    sharePercent: rule.doctorShares.consultantPercent,
  });
  addLine({
    participantId: participants.operatorId,
    pool: "DOCTOR",
    poolAmount: doctorPoolAmount,
    role: "OPERATOR",
    sharePercent: rule.doctorShares.operatorPercent,
  });
  addLine({
    participantId:
      participants.clinicalSupportId ??
      (rule.fallbackMissingClinicalSupportToOperator
        ? participants.operatorId
        : undefined),
    pool: "DOCTOR",
    poolAmount: doctorPoolAmount,
    role: "CLINICAL_SUPPORT",
    sharePercent: rule.doctorShares.clinicalSupportPercent,
    resolvedFromFallback: !participants.clinicalSupportId,
    sourceRole: !participants.clinicalSupportId ? "OPERATOR" : undefined,
  });

  addLine({
    participantId:
      participants.assistantPrimaryId ?? participants.assistantSecondaryId,
    pool: "ASSISTANT",
    poolAmount: assistantPoolAmount,
    role: "ASSISTANT_PRIMARY",
    sharePercent: rule.assistantShares.primaryPercent,
    resolvedFromFallback:
      !participants.assistantPrimaryId && Boolean(participants.assistantSecondaryId),
    sourceRole:
      !participants.assistantPrimaryId && participants.assistantSecondaryId
        ? "ASSISTANT_SECONDARY"
        : undefined,
  });
  addLine({
    participantId:
      participants.assistantSecondaryId ??
      (rule.fallbackMissingAssistantSecondaryToPrimary
        ? participants.assistantPrimaryId
        : undefined),
    pool: "ASSISTANT",
    poolAmount: assistantPoolAmount,
    role: "ASSISTANT_SECONDARY",
    sharePercent: rule.assistantShares.secondaryPercent,
    resolvedFromFallback: !participants.assistantSecondaryId,
    sourceRole: !participants.assistantSecondaryId
      ? "ASSISTANT_PRIMARY"
      : undefined,
  });

  return {
    earnedServiceAmount,
    doctorPoolAmount,
    assistantPoolAmount,
    totalCompensationAmount: doctorPoolAmount + assistantPoolAmount,
    unallocatedAmount: roundMoney(unallocatedAmount),
    lines,
  };
}

function percentOf(amount: number, percent: number) {
  return roundMoney(amount * (percent / 100));
}

function roundMoney(amount: number) {
  return Math.round(amount);
}
