type LookupKey = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export type PatientLookupCommand = "next" | "previous" | "select" | "dismiss" | "leave";

export function patientLookupCommand(event: LookupKey): PatientLookupCommand | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === "Tab") return "leave";
  // Modified keys belong to platform editing and assistive technology, not lookup.
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case "ArrowDown": return "next";
    case "ArrowUp": return "previous";
    case "Enter": return "select";
    case "Escape": return "dismiss";
    default: return null;
  }
}
