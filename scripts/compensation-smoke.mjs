import assert from "node:assert/strict";

import {
  calculateServiceProgressCompensation,
  defaultServiceCompensationRule,
} from "../src/lib/compensation.ts";

const operatorId = "operator";

const noAssistants = calculateServiceProgressCompensation({
  serviceAmount: 100_000,
  progressDeltaPercent: 100,
  participants: {
    consultantId: operatorId,
    operatorId,
  },
});

assert.equal(noAssistants.totalCompensationAmount, 12_000);
assert.equal(noAssistants.unallocatedAmount, 0);
assert.deepEqual(
  noAssistants.lines
    .filter((line) => line.pool === "ASSISTANT")
    .map((line) => ({
      role: line.role,
      participantId: line.participantId,
      amount: line.amount,
      sourceRole: line.sourceRole,
    })),
  [
    {
      role: "ASSISTANT_PRIMARY",
      participantId: operatorId,
      amount: 1_400,
      sourceRole: "OPERATOR",
    },
    {
      role: "ASSISTANT_SECONDARY",
      participantId: operatorId,
      amount: 600,
      sourceRole: "OPERATOR",
    },
  ],
);

const oneAssistant = calculateServiceProgressCompensation({
  serviceAmount: 100_000,
  progressDeltaPercent: 100,
  participants: {
    operatorId,
    assistantPrimaryId: "assistant-primary",
  },
});

assert.deepEqual(
  oneAssistant.lines
    .filter((line) => line.pool === "ASSISTANT")
    .map((line) => ({
      role: line.role,
      participantId: line.participantId,
      amount: line.amount,
      sourceRole: line.sourceRole,
    })),
  [
    {
      role: "ASSISTANT_PRIMARY",
      participantId: "assistant-primary",
      amount: 1_400,
      sourceRole: undefined,
    },
    {
      role: "ASSISTANT_SECONDARY",
      participantId: "assistant-primary",
      amount: 600,
      sourceRole: "ASSISTANT_PRIMARY",
    },
  ],
);

const secondaryAssistantOnly = calculateServiceProgressCompensation({
  serviceAmount: 100_000,
  progressDeltaPercent: 100,
  participants: {
    operatorId,
    assistantSecondaryId: "assistant-secondary",
  },
});

assert.deepEqual(
  secondaryAssistantOnly.lines
    .filter((line) => line.pool === "ASSISTANT")
    .map((line) => ({
      role: line.role,
      participantId: line.participantId,
      amount: line.amount,
      sourceRole: line.sourceRole,
    })),
  [
    {
      role: "ASSISTANT_PRIMARY",
      participantId: "assistant-secondary",
      amount: 1_400,
      sourceRole: "ASSISTANT_SECONDARY",
    },
    {
      role: "ASSISTANT_SECONDARY",
      participantId: "assistant-secondary",
      amount: 600,
      sourceRole: undefined,
    },
  ],
);

const twoAssistants = calculateServiceProgressCompensation({
  serviceAmount: 100_000,
  progressDeltaPercent: 100,
  participants: {
    operatorId,
    assistantPrimaryId: "assistant-primary",
    assistantSecondaryId: "assistant-secondary",
  },
});

assert.deepEqual(
  twoAssistants.lines
    .filter((line) => line.pool === "ASSISTANT")
    .map((line) => [line.role, line.participantId, line.amount]),
  [
    ["ASSISTANT_PRIMARY", "assistant-primary", 1_400],
    ["ASSISTANT_SECONDARY", "assistant-secondary", 600],
  ],
);

const noAssistantFallback = calculateServiceProgressCompensation({
  serviceAmount: 100_000,
  progressDeltaPercent: 100,
  participants: {
    consultantId: operatorId,
    operatorId,
  },
  rule: {
    ...defaultServiceCompensationRule,
    fallbackMissingAssistantPrimaryToOperator: false,
  },
});

assert.equal(
  noAssistantFallback.lines.some((line) => line.pool === "ASSISTANT"),
  false,
);
assert.equal(noAssistantFallback.unallocatedAmount, 2_000);

console.log("ok compensation fallback smoke");
