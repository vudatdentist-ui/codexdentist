"use client";

import { useDentalSuiteModel } from "./suite-model";
import { DentalSuiteView } from "./suite-view";

export function DentalSuite(props: Parameters<typeof useDentalSuiteModel>[0]) {
  const model = useDentalSuiteModel(props);
  return <DentalSuiteView {...model} />;
}
