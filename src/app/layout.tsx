import type { Metadata, Viewport } from "next";
import { unstable_noStore as noStore } from "next/cache";
import "./globals.css";
import { AntdProvider } from "@/modules/shared/ui/components/AntdProvider";
import ClientRuntimeBoot from "@/modules/shared/ui/components/ClientRuntimeBoot";
import { getSystemConfigMap } from "@/modules/system/services/system-config";
import { GAME_BRAND_CONFIG_KEYS } from "@/modules/system/services/system-config-keys";

const DEFAULT_GAME_TITLE = "灵虚·长生录";
const DEFAULT_GAME_SUBTITLE = "踏上修仙之路，问鼎长生大道";

export async function generateMetadata(): Promise<Metadata> {
  noStore();

  let gameTitle = DEFAULT_GAME_TITLE;
  let gameSubtitle = DEFAULT_GAME_SUBTITLE;

  try {
    const configMap = await getSystemConfigMap(GAME_BRAND_CONFIG_KEYS);
    gameTitle = configMap.GAME_TITLE?.trim() || DEFAULT_GAME_TITLE;
    gameSubtitle = configMap.GAME_SUBTITLE?.trim() || DEFAULT_GAME_SUBTITLE;
  } catch (error) {
    console.error("Get app metadata error:", error);
  }

  return {
    applicationName: gameTitle,
    title: gameTitle,
    description: `修仙文字网页游戏 - ${gameSubtitle}`,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: gameTitle,
      statusBarStyle: "black-translucent",
    },
    formatDetection: {
      telephone: false,
      date: false,
      address: false,
      email: false,
      url: false,
    },
    icons: {
      icon: [
        { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0d0d0f",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ClientRuntimeBoot />
        <AntdProvider>{children}</AntdProvider>
      </body>
    </html>
  );
}
