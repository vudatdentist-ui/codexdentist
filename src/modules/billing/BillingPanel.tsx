"use client";

import { useBillingPanelModel } from "./billing-model";
import { BillingPanelView } from "./billing-view";

export function BillingPanel(props: Parameters<typeof useBillingPanelModel>[0]) {
  const model = useBillingPanelModel(props);
  return <BillingPanelView {...model} />;
}
