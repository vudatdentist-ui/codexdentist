"use client";

import { createContext, useContext } from "react";

export type Language = "vi" | "en";

export const LanguageContext = createContext<{
  language: Language;
  // The shell keeps the full UI dictionary in DentalSuite while modules are
  // gradually extracted, so keep this permissive during the refactor.
  t: any;
}>({
  language: "vi",
  t: {},
});

export function useAppLanguage() {
  return useContext(LanguageContext);
}
