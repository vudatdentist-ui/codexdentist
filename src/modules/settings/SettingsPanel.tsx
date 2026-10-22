"use client";

import { useSettingsPanelModel } from "./settings-model";
import { SettingsPanelView } from "./settings-view";

export function SettingsPanel(props: Parameters<typeof useSettingsPanelModel>[0]) {
  const model = useSettingsPanelModel(props);
  return <SettingsPanelView {...model} />;
}
