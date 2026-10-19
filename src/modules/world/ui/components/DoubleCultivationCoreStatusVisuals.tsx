"use client";

import Image from "next/image";
import { useMemo } from "react";
import { Card, Space, Tag, Typography } from "antd";
import { useRenderClock } from "@/modules/combat/ui/hooks/useRenderClock";
import type { PlayerStatusView } from "@/types/game";
import styles from "@/modules/world/ui/components/DoubleCultivationCoreStatusVisuals.module.css";

const { Text } = Typography;

type DoubleCultivationGongfaBonuses = {
  xpBonusPct?: number;
  intimacyBonus?: number;
  maleEjaculationPct?: number;
  femaleSqueezePct?: number;
  maleSpermCapacityPct?: number;
  maleSpermRegenPct?: number;
  uterusDigestEfficiencyPct?: number;
  uterusDigestSecondsReduce?: number;
  maleDualAbsorbPct?: number;
  sexMaxUnlocked?: boolean;
};

export type DoubleCultivationVisualStats = {
  gender?: string | null;
  spermStorageMl?: number | null;
  spermRecoveryRemainingSeconds?: number | null;
  uterusStorageMl?: number | null;
  uterusCapacityMl?: number | null;
  uterusDigestUnlocked?: boolean;
  uterusDigestSecondsPerMl?: number | null;
  uterusDigestRemainingSeconds?: number | null;
  uterusNextDigestAt?: string | null;
  pregnancyStatus?: PlayerStatusView | null;
  pregnancyDisplayStatus?: PlayerStatusView | null;
  gongfaBonuses?: DoubleCultivationGongfaBonuses | null;
};

const PREGNANCY_STAGE_LABELS: Record<string, string> = {
  pregnancy: "受孕中",
  fertilized_1: "受孕初期",
  fertilized_2: "受孕稳定",
  fertilized_3: "胚胎成长",
  fertilized_4: "孕育中期",
  fertilized_5: "孕育后期",
  fertilized_6: "即将成熟",
  fertilized_7: "即将分娩",
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatCountdown(seconds: number | null | undefined) {
  if (seconds == null) {
    return "暂无";
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${remainingSeconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${remainingSeconds}秒`;
  }
  return `${remainingSeconds}秒`;
}

function formatShortCountdown(seconds: number | null | undefined) {
  if (seconds == null) {
    return "暂无";
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatDateTime(value?: string | null) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "暂无";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(parsed));
}

function buildLiveRemaining(baseSeconds: number | null | undefined, loadedAtMs: number, nowMs: number) {
  if (baseSeconds == null) {
    return null;
  }
  const elapsed = Math.max(0, Math.floor((nowMs - loadedAtMs) / 1000));
  return Math.max(0, Math.floor(baseSeconds) - elapsed);
}

function buildBonusChips(stats: DoubleCultivationVisualStats) {
  const bonuses = stats.gongfaBonuses || {};
  const chips: string[] = [];

  if (Number(bonuses.xpBonusPct || 0) > 0) {
    chips.push(`双修修为 +${Number(bonuses.xpBonusPct || 0)}%`);
  }
  if (Number(bonuses.intimacyBonus || 0) > 0) {
    chips.push(`${stats.gender === "男" ? "Sex值" : "淫乱度"} +${Number(bonuses.intimacyBonus || 0)}`);
  }
  if (stats.gender === "男") {
    if (Number(bonuses.maleSpermCapacityPct || 0) > 0) {
      chips.push(`精液上限 +${Number(bonuses.maleSpermCapacityPct || 0)}%`);
    }
    if (Number(bonuses.maleSpermRegenPct || 0) > 0) {
      chips.push(`精液恢复 +${Number(bonuses.maleSpermRegenPct || 0)}%`);
    }
    if (Number(bonuses.maleDualAbsorbPct || 0) > 0) {
      chips.push(`采补吸收 +${Number(bonuses.maleDualAbsorbPct || 0)}%`);
    }
  }
  if (stats.gender === "女") {
    if (Number(bonuses.femaleSqueezePct || 0) > 0) {
      chips.push(`榨精收益 +${Number(bonuses.femaleSqueezePct || 0)}%`);
    }
    if (Number(bonuses.uterusDigestEfficiencyPct || 0) > 0) {
      chips.push(`子宫转化 +${Number(bonuses.uterusDigestEfficiencyPct || 0)}%`);
    }
    if (Number(bonuses.uterusDigestSecondsReduce || 0) > 0) {
      chips.push(`转化缩时 ${Number(bonuses.uterusDigestSecondsReduce || 0)}s/ml`);
    }
  }

  return chips;
}

function resolvePregnancyStatusLabel(status: PlayerStatusView) {
  return String(status.title || "").trim() || "受孕状态";
}

function resolvePregnancyStageLabel(status: PlayerStatusView) {
  const title = String(status.stageTitle || "").trim();
  if (title) {
    return title;
  }
  const stageKey = String(status.stageKey || "").trim();
  if (stageKey && PREGNANCY_STAGE_LABELS[stageKey]) {
    return PREGNANCY_STAGE_LABELS[stageKey];
  }
  const statusKey = String(status.statusKey || "").trim();
  if (statusKey && PREGNANCY_STAGE_LABELS[statusKey]) {
    return PREGNANCY_STAGE_LABELS[statusKey];
  }
  return String(status.title || "").trim() || "未知阶段";
}

function resolveUterusStageAsset(fillPercent: number) {
  const safePercent = clampPercent(fillPercent);
  const stageIndex = Math.max(1, Math.min(7, Math.ceil((safePercent || 1) / (100 / 7))));
  return `/double-cultivation/uterus-static/stage-${String(stageIndex).padStart(2, "0")}.png`;
}

function PregnancyStatusCard({
  status,
  loadedAtMs,
}: {
  status: PlayerStatusView;
  loadedAtMs: number;
}) {
  const nowMs = useRenderClock(true);

  const remaining = buildLiveRemaining(status.remainingSeconds, loadedAtMs, nowMs);
  const effects = Array.isArray(status.effectSummary) ? status.effectSummary : [];

  return (
    <Card size="small" className={styles.pregnancyShell}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>受孕状态</div>
        </div>
        <div className={styles.tagRow}>
          <Tag color="gold">{resolvePregnancyStatusLabel(status)}</Tag>
          <Tag color="orange">{resolvePregnancyStageLabel(status)}</Tag>
        </div>
      </div>

      <div className={styles.pregnancyBody}>
        <div className={styles.pregnancyIconWrap}>
          {status.iconImageUrl ? (
            <Image
              className={styles.pregnancyIcon}
              src={status.iconImageUrl}
              alt={resolvePregnancyStageLabel(status)}
              width={88}
              height={88}
              unoptimized
            />
          ) : (
            <div className={styles.pregnancyFallback} aria-hidden="true" />
          )}
        </div>
        <div className={styles.pregnancyMeta}>
          <div>
            <div className={styles.pregnancyStage}>{resolvePregnancyStageLabel(status)}</div>
            <div className={styles.pregnancyDesc}>
              下一次变化：{remaining == null ? "暂无" : formatCountdown(remaining)}
            </div>
          </div>
          {effects.length > 0 ? (
            <div className={styles.pregnancyEffects}>
              {effects.map((line) => (
                <div key={line} className={styles.pregnancyEffect}>{line}</div>
              ))}
            </div>
          ) : (
            <div className={styles.pregnancyDesc}>当前没有额外受孕状态。</div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function DoubleCultivationCoreStatusVisuals({
  stats,
  loadedAtMs,
}: {
  stats: DoubleCultivationVisualStats | null;
  loadedAtMs: number;
}) {
  const nowMs = useRenderClock(true);

  const liveSpermRemaining = buildLiveRemaining(stats?.spermRecoveryRemainingSeconds, loadedAtMs, nowMs);
  const liveDigestRemaining = buildLiveRemaining(stats?.uterusDigestRemainingSeconds, loadedAtMs, nowMs);
  const bonusChips = useMemo(() => buildBonusChips(stats || {}), [stats]);

  if (!stats?.gender) {
    return null;
  }

  const pregnancyStatus = stats.pregnancyDisplayStatus || stats.pregnancyStatus || null;

  if (stats.gender === "男") {
    const capacityPct = Number(stats.gongfaBonuses?.maleSpermCapacityPct || 0);
    const estimatedMaxStorage = Math.max(
      Number(stats.spermStorageMl || 0),
      Math.floor(100 * (1 + Math.max(0, capacityPct) / 100)),
    );
    const fillPercent = clampPercent((Number(stats.spermStorageMl || 0) / Math.max(1, estimatedMaxStorage)) * 100);

    return (
      <div className={styles.stack}>
        <Card size="small" className={styles.shell}>
          <div className={styles.head}>
            <div>
              <div className={styles.title}>精液储量</div>
              <div className={styles.subtitle}>这里显示当前精液、上限和恢复时间。</div>
            </div>
            <div className={styles.tagRow}>
              <Tag color="blue">男修</Tag>
              <Tag color={fillPercent >= 85 ? "volcano" : fillPercent >= 55 ? "gold" : "green"}>
                {Math.round(fillPercent)}%
              </Tag>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.visualFrame}>
              <div className={styles.assetImageWrap}>
                <div className={styles.spermLiquidBackdrop}>
                  <div className={styles.spermLiquidFill} style={{ height: `${fillPercent}%` }} />
                </div>
                <Image
                  className={styles.assetImage}
                  src="/double-cultivation/sperm-reservoir.svg"
                  alt="精液储量图"
                  width={220}
                  height={220}
                  unoptimized
                />
              </div>
              <div className={styles.overlayBadge}>{Math.round(fillPercent)}%</div>
            </div>

            <div>
              <div className={styles.metricList}>
                <div className={styles.metric}>
                  <div className={styles.metricLabel}>当前精液</div>
                  <div className={styles.metricValue}>{Number(stats.spermStorageMl || 0)} ml</div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLabel}>当前上限</div>
                  <div className={styles.metricValue}>{estimatedMaxStorage} ml</div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLabel}>恢复倒计时</div>
                  <div className={styles.metricValue}>{formatShortCountdown(liveSpermRemaining)}</div>
                </div>
              </div>

              <div className={styles.meter}>
                <div className={styles.meterHead}>
                  <span>精液占比</span>
                  <span>{Number(stats.spermStorageMl || 0)} / {estimatedMaxStorage} ml</span>
                </div>
                <div className={styles.meterTrack}>
                  <div className={styles.meterFill} style={{ width: `${fillPercent}%` }} />
                </div>
              </div>

              {bonusChips.length > 0 ? (
                <div className={styles.bonusRow}>
                  {bonusChips.map((chip) => (
                    <div key={chip} className={styles.bonusChip}>{chip}</div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const storage = Number(stats.uterusStorageMl || 0);
  const capacity = Math.max(1, Number(stats.uterusCapacityMl || 120));
  const fillPercent = clampPercent((storage / capacity) * 100);
  const uterusStageAsset = resolveUterusStageAsset(fillPercent);
  const statusTone = fillPercent >= 90 ? "error" : fillPercent >= 70 ? "warning" : "success";

  return (
    <div className={styles.stack}>
      <Card size="small" className={styles.shell}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>子宫留精</div>
          </div>
          <div className={styles.tagRow}>
            <Tag color="magenta">女修</Tag>
            <Tag color={statusTone === "error" ? "volcano" : statusTone === "warning" ? "gold" : "green"}>
              {Math.round(fillPercent)}%
            </Tag>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.visualFrame}>
            <div className={styles.assetImageWrap}>
              <Image
                className={styles.assetImage}
                src={uterusStageAsset}
                alt={`子宫精液储量 ${Math.round(fillPercent)}%`}
                width={220}
                height={260}
                unoptimized
              />
            </div>
            <div className={styles.overlayBadge}>{Math.round(fillPercent)}%</div>
          </div>

          <div>
            <div className={styles.metricList}>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>当前留精</div>
                <div className={styles.metricValue}>{storage} / {capacity} ml</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>子宫转化</div>
                <div className={styles.metricValue}>
                  {stats.uterusDigestUnlocked
                    ? `${formatShortCountdown(liveDigestRemaining)}`
                    : "未解锁"}
                </div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>下次转化</div>
                <div className={styles.metricValue}>{formatDateTime(stats.uterusNextDigestAt)}</div>
              </div>
            </div>

            <div className={styles.meter}>
              <div className={styles.meterHead}>
                <span>子宫精液储量</span>
                <span>{storage} / {capacity} ml</span>
              </div>
              <div className={styles.meterTrack}>
                <div className={styles.meterFill} style={{ width: `${fillPercent}%` }} />
              </div>
            </div>

            <div className={styles.uterusHint}>
              {stats.uterusDigestUnlocked && stats.uterusDigestSecondsPerMl
                ? `当前转化速度：1 ml / ${formatCountdown(stats.uterusDigestSecondsPerMl)}`
                : "子宫转化未解锁，需要先把一门双修功法练满。"}
            </div>

            {bonusChips.length > 0 ? (
              <div className={styles.bonusRow}>
                {bonusChips.map((chip) => (
                  <div key={chip} className={styles.bonusChip}>{chip}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {pregnancyStatus ? <PregnancyStatusCard status={pregnancyStatus} loadedAtMs={loadedAtMs} /> : null}
      {!pregnancyStatus ? (
        <Card size="small" className={styles.pregnancyShell}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text style={{ color: "#fff5db", fontWeight: 700 }}>受孕状态</Text>
            <Text style={{ color: "rgba(255,240,210,0.78)" }}>
              当前没有受孕状态，子宫留精和转化会继续正常记录。
            </Text>
          </Space>
        </Card>
      ) : null}
    </div>
  );
}
