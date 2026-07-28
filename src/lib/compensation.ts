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
  fallbackMissingAssistantPrimaryToOperator: boolean;
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
  fallbackMissingAssistantPrimaryToOperator: true,
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

  const assistantPrimaryParticipantId =
    participants.assistantPrimaryId ??
    participants.assistantSecondaryId ??
    (rule.fallbackMissingAssistantPrimaryToOperator
      ? participants.operatorId
      : undefined);
  const assistantPrimarySourceRole = participants.assistantPrimaryId
    ? undefined
    : participants.assistantSecondaryId
      ? "ASSISTANT_SECONDARY"
      : assistantPrimaryParticipantId
        ? "OPERATOR"
        : undefined;

  addLine({
    participantId: assistantPrimaryParticipantId,
    pool: "ASSISTANT",
    poolAmount: assistantPoolAmount,
    role: "ASSISTANT_PRIMARY",
    sharePercent: rule.assistantShares.primaryPercent,
    resolvedFromFallback: Boolean(assistantPrimarySourceRole),
    sourceRole: assistantPrimarySourceRole,
  });

  const assistantSecondaryParticipantId =
    participants.assistantSecondaryId ??
    (rule.fallbackMissingAssistantSecondaryToPrimary
      ? participants.assistantPrimaryId ??
        (rule.fallbackMissingAssistantPrimaryToOperator
          ? participants.operatorId
          : undefined)
      : undefined);
  const assistantSecondarySourceRole = participants.assistantSecondaryId
    ? undefined
    : participants.assistantPrimaryId
      ? "ASSISTANT_PRIMARY"
      : assistantSecondaryParticipantId
        ? "OPERATOR"
        : undefined;

  addLine({
    participantId: assistantSecondaryParticipantId,
    pool: "ASSISTANT",
    poolAmount: assistantPoolAmount,
    role: "ASSISTANT_SECONDARY",
    sharePercent: rule.assistantShares.secondaryPercent,
    resolvedFromFallback: Boolean(assistantSecondarySourceRole),
    sourceRole: assistantSecondarySourceRole,
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
