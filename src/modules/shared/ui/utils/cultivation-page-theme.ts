import type { CSSProperties } from "react";

export const CULTIVATION_PAGE_BACKGROUND = "radial-gradient(120% 95% at 50% -18%, rgba(218, 229, 246, 0.15) 0%, rgba(218, 229, 246, 0.04) 28%, rgba(0, 0, 0, 0) 52%), radial-gradient(92% 72% at 18% 10%, rgba(112, 156, 214, 0.16) 0%, rgba(112, 156, 214, 0.03) 42%, rgba(0, 0, 0, 0) 72%), radial-gradient(88% 70% at 82% 14%, rgba(205, 175, 116, 0.12) 0%, rgba(205, 175, 116, 0.02) 38%, rgba(0, 0, 0, 0) 70%), linear-gradient(180deg, #161922 0%, #10131a 42%, #0b0e14 100%)";

/**
 * 纵屏游戏舞台宽度（px）。
 *
 * 铁律：游戏页是「竖屏舞台」，不是横向后台面板。PC / 平板 / 桌面浏览器只是把
 * 这块 480px 宽的舞台居中摆在一个更高的视口里，绝不允许因为视口变宽就把
 * 战斗区、地图区横向拉成左右分栏的后台表格。
 *
 * 新增 /game 页面时必须复用本常量或 `cultivationPageShellStyle`，不要另写宽度。
 */
export const GAME_PORTRAIT_STAGE_MAX_WIDTH = 480;

export const cultivationPageShellStyle: CSSProperties = {
  padding: "10px 8px 18px",
  maxWidth: GAME_PORTRAIT_STAGE_MAX_WIDTH,
  margin: "0 auto",
  background: CULTIVATION_PAGE_BACKGROUND,
};

export const cultivationPageWideShellStyle: CSSProperties = {
  ...cultivationPageShellStyle,
  maxWidth: 560,
};

export const cultivationHeroCardStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(25, 30, 44, 0.92) 0%, rgba(14, 18, 27, 0.94) 100%)",
  border: "1px solid rgba(184, 207, 234, 0.14)",
  boxShadow: "0 20px 42px rgba(0,0,0,0.32), inset 0 1px 0 rgba(246,249,255,0.08), inset 0 -18px 36px rgba(126, 154, 193, 0.05)",
  backdropFilter: "blur(12px)",
  overflow: "hidden",
};

export const cultivationSectionCardStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(22, 28, 44, 0.9) 0%, rgba(15, 19, 31, 0.94) 100%)",
  border: "1px solid rgba(141, 168, 197, 0.16)",
  boxShadow: "0 14px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(245,248,255,0.05), inset 0 -14px 24px rgba(86, 118, 160, 0.05)",
  backdropFilter: "blur(10px)",
};

export const cultivationSoftPanelStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(134, 163, 196, 0.16)",
  background: "linear-gradient(180deg, rgba(23, 28, 41, 0.82) 0%, rgba(16, 20, 30, 0.88) 100%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -10px 18px rgba(107, 139, 184, 0.04)",
  backdropFilter: "blur(8px)",
};

export const cultivationCompactBarStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(150, 175, 205, 0.18)",
  background: "linear-gradient(180deg, rgba(24, 29, 43, 0.9) 0%, rgba(16, 20, 30, 0.94) 100%)",
  boxShadow: "0 12px 26px rgba(0,0,0,0.2), inset 0 1px 0 rgba(249,250,255,0.05)",
};

export const cultivationChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid rgba(160, 184, 214, 0.22)",
  background: "rgba(25, 31, 44, 0.58)",
  color: "#d8e3f0",
  fontSize: 11,
  lineHeight: 1.2,
};

export const cultivationTitleTextStyle: CSSProperties = {
  color: "#e4edf7",
  fontSize: 13,
  fontWeight: 600,
};

export const cultivationMutedTextStyle: CSSProperties = {
  color: "#93a2b5",
  fontSize: 12,
};

export const cultivationHintTextStyle: CSSProperties = {
  color: "#718096",
  fontSize: 11,
};

export const cultivationValueTextStyle: CSSProperties = {
  color: "#f4f9ff",
  fontSize: 16,
  fontWeight: 600,
};

export function buildCultivationActionButtonStyle(options?: {
  active?: boolean;
  accentColor?: string;
  dreamy?: boolean;
}): CSSProperties {
  const accentColor = options?.accentColor || "#b9d7f4";
  const active = Boolean(options?.active);
  const dreamy = Boolean(options?.dreamy);
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 32,
    padding: "0 12px",
    borderRadius: dreamy ? 14 : 12,
    border: active ? `1px solid ${accentColor}` : "1px solid rgba(145, 170, 201, 0.18)",
    background: active
      ? "linear-gradient(180deg, rgba(110, 141, 186, 0.28) 0%, rgba(34, 44, 66, 0.92) 54%, rgba(22, 27, 39, 0.96) 100%)"
      : "linear-gradient(180deg, rgba(23, 28, 41, 0.72) 0%, rgba(15, 19, 29, 0.86) 100%)",
    color: active ? "#f7fbff" : "#d8e3ef",
    boxShadow: active
      ? "0 10px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 24px rgba(143, 186, 245, 0.08)"
      : "inset 0 1px 0 rgba(255,255,255,0.05)",
    transition: "transform 0.18s ease, border-color 0.18s ease, color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
    cursor: "pointer",
    backdropFilter: "blur(10px)",
  };
}

export function buildCultivationRevealStyle(delayMs = 0): CSSProperties {
  return {
    animation: "cultivation-page-reveal 0.34s ease-out both",
    animationDelay: `${delayMs}ms`,
  };
}
