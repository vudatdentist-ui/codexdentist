import "server-only";

// Never propagate provider bodies into AI run errors: a failed provider can echo
// prompts, patient data or credentials. Bound successful responses before parsing.
export async function readAiProviderJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`AI provider returned HTTP ${response.status}.`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
    await response.body?.cancel();
    throw new Error("AI provider returned an invalid response.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 524288) {
        await reader.cancel();
        throw new Error("AI provider response exceeds the supported size.");
      }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("AI provider returned invalid JSON."); }
  } finally { reader.releaseLock(); }
}
