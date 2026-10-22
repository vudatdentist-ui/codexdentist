import type { ServiceStepSummary } from "@/lib/services-types";

export function serviceProgressPercent(progress: string) {
  const explicitPercent = progress.match(/\((\d+)%\)/);

  if (explicitPercent) {
    return Number(explicitPercent[1]);
  }

  const progressPercent: Record<string, number> = {
    Accepted: 0,
    Cancelled: 0,
    Completed: 100,
    Declined: 0,
    Draft: 0,
    "In progress": 10,
    "In Progress": 10,
    Planned: 0,
    Presented: 0,
  };

  return progressPercent[progress] ?? 0;
}

export function serviceProgressIsCancelled(progress: string) {
  return progress === "Cancelled";
}

export function serviceProgressLabelFromPercent(
  percent: number,
  status?: string,
  steps: ServiceStepSummary[] = [],
) {
  if (status === "CANCELLED") {
    return "Cancelled";
  }

  if (percent <= 0) {
    return "Planned (0%)";
  }

  if (percent >= 100 || status === "COMPLETED") {
    return "Completed (100%)";
  }

  if (percent <= 10) {
    return "In progress";
  }

  const roundedPercent = Math.round(percent);
  const matchingStep = steps.find(
    (step) => Math.round(step.defaultProgress ?? -1) === roundedPercent,
  );

  if (matchingStep) {
    return `${matchingStep.sequence}. ${matchingStep.name} (${roundedPercent}%)`;
  }

  const knownStepLabels: Record<number, string> = {
    20: "Step 1 (20%)",
    40: "Step 2 (40%)",
    55: "Step 3 (55%)",
    70: "Step 4 (70%)",
  };

  return knownStepLabels[roundedPercent] ?? `Step (${roundedPercent}%)`;
}
