export type ChatwootConversation = { id: string; status: string; url: string | null };
export type ChatwootPatientWorkspace = {
  patientId: string;
  state: "EMPTY" | "SAVED" | "UNKNOWN" | "DISABLED" | "PERMISSION";
  canManage: boolean;
  opaqueIdentifier: string | null;
  contactId: string | null;
  conversations: ChatwootConversation[];
};

// Never accept a provider-returned redirect or a credential-bearing URL.
export function safeChatwootLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
      /^\/app\/accounts\/[1-9][0-9]*\/conversations\/[1-9][0-9]*$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
