const string = { type: "string", maxLength: 500 };
export const accountingAiAnalysisSchema = {
  type: "object", additionalProperties: false,
  properties: {
    summary: string,
    alerts: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false,
      properties: { severity: { type: "string", enum: ["info", "watch", "critical"] }, title: string, detail: string, metric: string },
      required: ["severity", "title", "detail", "metric"] } },
    actions: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false,
      properties: { priority: { type: "string", enum: ["high", "medium", "low"] }, title: string, detail: string },
      required: ["priority", "title", "detail"] } },
    questions: { type: "array", maxItems: 2, items: string },
    caveats: { type: "array", maxItems: 2, items: string },
  }, required: ["summary", "alerts", "actions", "questions", "caveats"],
};

export function validateAccountingAiAnalysis(value: unknown) {
  const fail = () => { throw new Error("AI response did not match the requested accounting format."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const output = value as Record<string, unknown>;
  if (typeof output.summary !== "string" || !output.summary.trim()) return fail();
  const strings = (item: unknown, keys: string[]) => item && typeof item === "object" && !Array.isArray(item) &&
    keys.every(key => typeof (item as Record<string, unknown>)[key] === "string");
  if (!Array.isArray(output.alerts) || output.alerts.some(item => !strings(item, ["severity", "title", "detail", "metric"]) ||
      !["info", "watch", "critical"].includes(item.severity)) ||
      !Array.isArray(output.actions) || output.actions.some(item => !strings(item, ["priority", "title", "detail"]) ||
      !["high", "medium", "low"].includes(item.priority)) ||
      ["questions", "caveats"].some(key => !Array.isArray(output[key]) || output[key].some(item => typeof item !== "string"))) return fail();
}
