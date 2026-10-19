"use client";

import { ConfigProvider, theme, App } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

const gameTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#c9a84c",
    colorBgContainer: "#1a1a2e",
    colorBgElevated: "#16213e",
    colorBgLayout: "#0d0d0f",
    colorBorder: "#2a2520",
    colorBorderSecondary: "#1f1b17",
    colorText: "#e8e0d0",
    colorTextSecondary: "#a09880",
    colorTextTertiary: "#6b6355",
    colorSuccess: "#52b788",
    colorError: "#d4545d",
    colorWarning: "#e8d282",
    colorInfo: "#457b9d",
    borderRadius: 4,
    fontSize: 14,
    fontFamily:
      '"Noto Serif SC", "Songti SC", "SimSun", "STSong", serif',
    controlHeight: 36,
  },
  components: {
    Button: {
      primaryShadow: "none",
      defaultBorderColor: "#6b5a2f",
      defaultColor: "#c9a84c",
      defaultBg: "transparent",
    },
    Card: {
      headerBg: "#16213e",
      colorBgContainer: "#1a1a2e",
      colorBorderSecondary: "#2a2520",
    },
    Menu: {
      darkItemBg: "#0d0d0f",
      darkItemSelectedBg: "#1a1a2e",
      darkItemColor: "#a09880",
      darkItemSelectedColor: "#c9a84c",
    },
    Input: {
      activeBorderColor: "#c9a84c",
      hoverBorderColor: "#8b6914",
    },
    Modal: {
      contentBg: "#1a1a2e",
      headerBg: "#16213e",
    },
    Progress: {
      defaultColor: "#c9a84c",
    },
    Tabs: {
      inkBarColor: "#c9a84c",
      itemSelectedColor: "#c9a84c",
      itemColor: "#a09880",
    },
    Tag: {
      defaultBg: "#16213e",
      defaultColor: "#a09880",
    },
    Message: {
      contentBg: "#1a1a2e",
    },
  },
};

export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider theme={gameTheme} locale={zhCN}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
