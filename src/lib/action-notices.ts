const actionNoticeErrorPattern =
  /denied|missing|bad|invalid|not-found|unavailable|database|conflict|exists|empty|locked|failed|error|expired|negative/i;
const actionNoticeSuccessPattern =
  /accepted|adjusted|allocated|cancelled|completed|confirmed|created|deleted|generated|invoiced|issued|paid|received|recorded|renewed|retried|saved|sent|signed|started|stopped|updated|uploaded|voided/i;

export function visibleActionNoticeParam(notice: string | null) {
  if (!notice) {
    return null;
  }

  if (notice === "module-ai-ready" || notice === "module-ai-failed") {
    return notice;
  }

  return actionNoticeErrorPattern.test(notice) || actionNoticeSuccessPattern.test(notice)
    ? notice
    : null;
}
