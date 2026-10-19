import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.immortality.game",
  appName: "修仙·明日生机",
  webDir: "capacitor-shell",
  android: {
    allowMixedContent: Boolean(serverUrl && serverUrl.startsWith("http://")),
  },
};

if (serverUrl) {
  config.server = {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  };
}

export default config;
