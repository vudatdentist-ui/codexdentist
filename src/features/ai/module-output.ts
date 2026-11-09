const text = { type: "string", minLength: 1, maxLength: 600 };
const list = { type: "array", maxItems: 2, items: { type: "string", maxLength: 240 } };
export const moduleAiOutputSchema = {
  type: "object", additionalProperties: false,
  properties: { answer: text, takeaways: list, suggestedActions: list, caveats: list },
  required: ["answer", "takeaways", "suggestedActions", "caveats"],
};

export function validateModuleAiOutput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI response did not match the requested answer format.");
  const output = value as Record<string, unknown>;
  if (typeof output.answer !== "string" || !output.answer.trim() || output.answer.length > 20000 ||
      ["takeaways", "suggestedActions", "caveats"].some(key => !Array.isArray(output[key]) ||
        output[key].length > 20 || output[key].some(item => typeof item !== "string" || item.length > 4000))) {
    throw new Error("AI response did not match the requested answer format.");
  }
}
