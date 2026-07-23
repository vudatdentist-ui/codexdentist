import type { CapacitorConfig } from "@capacitor/cli";

const mobileServerUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: "vn.nhavista.mobile",
  appName: "NhaVista",
  webDir: "public",
  server: mobileServerUrl
    ? {
        url: mobileServerUrl,
        cleartext: mobileServerUrl.startsWith("http://"),
      }
    : undefined,
  android: {
    allowMixedContent: false,
  },
};

export default config;
