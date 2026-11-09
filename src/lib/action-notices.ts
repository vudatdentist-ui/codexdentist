const actionNoticeErrorPattern =
  /denied|missing|bad|invalid|not-found|unavailable|unsupported|unreconciled|database|conflict|exists|empty|locked|failed|error|expired|negative/i;
const actionNoticeSuccessPattern =
  /accepted|adjusted|allocated|cancelled|completed|confirmed|created|deleted|generated|invoiced|issued|paid|received|recorded|renewed|retried|saved|sent|signed|started|stopped|updated|uploaded|voided/i;

export function shouldKeepActionNotice(notice: string) {
  return notice === "module-ai-ready" || notice === "module-ai-failed" || actionNoticeErrorPattern.test(notice);
}

export function visibleActionNoticeParam(notice: string | null) {
  // Assistant results are rendered by their own dialog. Passing a successful
  // assistant notice into a module's action map produced a false failure banner.
  if (notice === "module-ai-ready" || notice === "module-ai-failed") return null;
  if (!notice) {
    return null;
  }

  return shouldKeepActionNotice(notice) || actionNoticeSuccessPattern.test(notice)
    ? notice
    : null;
}
