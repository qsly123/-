"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_ROOM_NAMES, type CombatCommandPayload, type CombatSceneEnvelope } from "@immortality/shared-protocol";
import { ArrowLeftOutlined, DownOutlined, ThunderboltOutlined, UpOutlined } from "@ant-design/icons";
import { App, Button, message } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import BattleActionPanel from "@/modules/combat/ui/components/BattleActionPanel";
import BattlePageStateCard from "@/modules/combat/ui/components/BattlePageStateCard";
import BattleViewHeaderCard from "@/modules/combat/ui/components/BattleViewHeaderCard";
import BattleStageBackdropCanvas from "@/modules/combat/ui/components/BattleStageBackdropCanvas";
import BattleStageEntityCanvas from "@/modules/combat/ui/components/BattleStageEntityCanvas";
import UnifiedBattleShell from "@/modules/combat/ui/components/UnifiedBattleShell";
import { buildBossBattleViewState } from "@/modules/combat/services/battle-view";
import { getBattleSceneFeedbackAnchor } from "@/modules/combat/services/battle-scene-feedback";
import { useBattleSceneRenderAnchorMap } from "@/modules/combat/ui/hooks/useBattleSceneRenderAnchorMap";
import {
  formatInventorySyncHint,
  useCombatConsumableInventory,
} from "@/modules/combat/ui/hooks/useCombatConsumableInventory";
import {
  materializeBattleSceneSnapshot,
  type BattleSceneSnapshot,
} from "@/modules/combat/services/battle-scene-state";
import { useCombatColyseusRoom } from "@/modules/combat/ui/hooks/useCombatColyseusRoom";
import { createActionRequestMeta } from "@/modules/shared/services/action-request";
import { getSkillVisualEffectDurationMs } from "@/modules/shared/services/skill-visual-effect";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import PlayerAvatar from "@/modules/shared/ui/components/PlayerAvatar";
import RewardDropList from "@/modules/shared/ui/components/RewardDropList";
import type {
  BattleViewState,
  BossEvent,
  BossParticipant,
  CombatSkillVisualEffect,
  CombatTurnState,
} from "@/types/game";

type BossDetail = {
  id: string;
  name: string;
  description: string | null;
  avatarImageUrl?: string | null;
  hp: number;
  attack: number;
  defense: number;
};

type SkillView = {
  name: string;
  mpCost: number;
  cooldown?: number;
  skillType?: string;
  visualEffect?: CombatSkillVisualEffect | null;
};

type RewardView = {
  playerId: string;
  playerName: string;
  xp: number;
  gold: number;
  isLastHit: boolean;
  rewarded?: boolean;
  noRewardReason?: "stamina_empty";
  drops?: { itemId: string; itemName: string; itemIconUrl?: string | null; quantity: number; itemRarity?: string | null }[];
};

type BossStageSide = "player" | "boss";

type BossPopupState = {
  id: number;
  targetSide: BossStageSide;
  targetSlot?: number | null;
  label: string;
  kind: "damage" | "heal";
};

type BossMotionState = {
  id: number;
  actorSide: BossStageSide;
  actorSlot?: number | null;
  targetSide: BossStageSide;
  targetSlot?: number | null;
  visualEffect?: CombatSkillVisualEffect | null;
};

type BossHudSlot = {
  key: string;
  slotTitle: string;
  badge: string | null;
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  avatarImageUrl?: string | null;
  avatarFrameImageUrl?: string | null;
  fallbackText: string;
  className: string;
  isEmpty: boolean;
};

const BOSS_UNAVAILABLE_EXIT_ERROR_KEYWORDS = [
  "首领不存在",
  "该秘境已结束",
  "已返回地图",
  "首领状态已刷新",
];
const INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY = "game:invalid-boss-encounter-redirect-guard";
const INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_TTL_MS = 30_000;

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function shouldLeaveBossPageOnUnavailable(payload?: {
  redirectToMap?: boolean;
  error?: string;
  settled?: boolean;
  bossUnavailableReason?: string;
} | null, status?: number) {
  if (payload?.redirectToMap || payload?.settled || Boolean(payload?.bossUnavailableReason)) {
    return true;
  }
  if (status === 409 || status === 410) {
    return true;
  }
  if (status !== 404) {
    return false;
  }
  const errorText = (payload?.error || "").trim();
  return BOSS_UNAVAILABLE_EXIT_ERROR_KEYWORDS.some((keyword) => errorText.includes(keyword));
}

function buildPartyBossEncounterRoutePath(monsterId: string, partyCombatId?: string | null) {
  const normalizedPartyCombatId = typeof partyCombatId === "string" ? partyCombatId.trim() : "";
  if (!normalizedPartyCombatId) {
    return "";
  }
  return `/game/boss/${monsterId}?partyCombatId=${encodeURIComponent(normalizedPartyCombatId)}`;
}

function persistInvalidBossEncounterRedirectGuard(params: {
  encounterId?: string | null;
  routePath?: string;
}) {
  if (typeof window === "undefined") {
    return;
  }
  const encounterId = typeof params.encounterId === "string" ? params.encounterId.trim() : "";
  const routePath = typeof params.routePath === "string" ? params.routePath.trim() : "";
  if (!encounterId || !routePath) {
    return;
  }

  try {
    window.sessionStorage.setItem(INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_STORAGE_KEY, JSON.stringify({
      encounterId,
      routePath,
      expiresAt: Date.now() + INVALID_BOSS_ENCOUNTER_REDIRECT_GUARD_TTL_MS,
    }));
  } catch {
    // sessionStorage 不可用时忽略，仍继续返回地图。
  }
}

async function readBossApiResponse<T extends {
  success?: boolean;
  error?: string;
}>(response: Response): Promise<T> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return await response.json() as T;
    } catch {
      // Fall through to the plain-text fallback so 404 pages do not strand the player.
    }
  }

  let errorText = "";
  try {
    errorText = (await response.text()).trim();
  } catch {
    errorText = "";
  }

  if (!errorText) {
    if (response.status === 404) {
      errorText = "首领不存在";
    } else if (response.status === 409) {
      errorText = "该秘境首领状态已刷新，请返回地图后重新进入。";
    } else if (response.status === 410) {
      errorText = "该秘境已结束，正在返回地图。";
    } else {
      errorText = "请求失败";
    }
  }

  return {
    success: response.ok,
    error: errorText,
  } as T;
}

type BossNextIntent = BossEvent["bossNextIntent"];
type BossCounterResult = NonNullable<BossEvent["bossCounterResults"]>[number];

type BossApiResponse = {
  success?: boolean;
  error?: string;
  redirectToMap?: boolean;
  settled?: boolean;
  bossUnavailableReason?: string;
  respawnRemainingSeconds?: number;
  participants?: BossParticipant[];
  data?: {
    monster: BossDetail;
    instance: {
      currentHp: number;
      maxHp: number;
      status: string;
    } | null;
    respawnRemainingSeconds?: number;
    participants?: BossParticipant[];
    joined?: boolean;
    roomFull?: boolean;
    canAttack?: boolean;
    mySlot?: number | null;
    partyCombatId?: string | null;
    sceneSnapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState;
    turnState?: CombatTurnState | null;
    bossNextIntent?: BossNextIntent | null;
    player: {
      id: string;
      name: string;
      hp: number;
      maxHp: number;
      mp: number;
      maxMp: number;
      skills: string[];
    };
    skillsData: Record<string, SkillView>;
  };
};

type BossActionResponse = {
  success?: boolean;
  error?: string;
  redirectToMap?: boolean;
  settled?: boolean;
  bossUnavailableReason?: string;
  respawnRemainingSeconds?: number;
  participants?: BossParticipant[];
  data?: {
    damage?: number;
    bossHp: number;
    bossMaxHp: number;
    bossDead?: boolean;
    bossCounterDamage?: number;
    bossCounterSkillName?: string | null;
    bossCounterResults?: BossCounterResult[] | null;
    playerHp: number;
    playerMp: number;
    skillName: string;
    skillOutcome?: "damage" | "heal" | "utility";
    recoveredHp?: number;
    recoveredMp?: number;
    rewards?: RewardView[] | null;
    respawnRemainingSeconds?: number;
    participants?: BossParticipant[];
    roomFull?: boolean;
    joined?: boolean;
    canAttack?: boolean;
    mySlot?: number | null;
    partyCombatId?: string | null;
    sceneSnapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState;
    commandResult?: {
      acceptedClientSequence?: number;
      serverSceneTick?: number;
    } | null;
    acceptedClientSequence?: number;
    serverSceneTick?: number;
    died?: boolean;
    message?: string;
    turnState?: CombatTurnState | null;
    bossNextIntent?: BossNextIntent | null;
  };
};

type BossAdvanceResponse = {
  success?: boolean;
  error?: string;
  redirectToMap?: boolean;
  settled?: boolean;
  bossUnavailableReason?: string;
  respawnRemainingSeconds?: number;
  participants?: BossParticipant[];
  data?: {
    bossHp?: number;
    bossMaxHp?: number;
    playerHp?: number;
    playerMp?: number;
    playerMaxHp?: number;
    playerMaxMp?: number;
    respawnRemainingSeconds?: number;
    participants?: BossParticipant[];
    joined?: boolean;
    roomFull?: boolean;
    canAttack?: boolean;
    mySlot?: number | null;
    partyCombatId?: string | null;
    sceneSnapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState;
    commandResult?: {
      acceptedClientSequence?: number;
      serverSceneTick?: number;
    } | null;
    acceptedClientSequence?: number;
    serverSceneTick?: number;
    bossDead?: boolean;
    died?: boolean;
    message?: string;
    rewards?: RewardView[] | null;
    turnState?: CombatTurnState | null;
    bossNextIntent?: BossNextIntent | null;
  };
};

function normalizeTurnState(value?: CombatTurnState | null) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    turnOrder: Array.isArray(value.turnOrder) ? value.turnOrder.filter((entry) => typeof entry === "string") : [],
    currentTurnPlayerId: typeof value.currentTurnPlayerId === "string" ? value.currentTurnPlayerId : null,
    turnIndex: Number.isFinite(value.turnIndex) ? value.turnIndex : 0,
    turnDeadlineAt: typeof value.turnDeadlineAt === "string" ? value.turnDeadlineAt : null,
    eligibleMemberIds: Array.isArray(value.eligibleMemberIds)
      ? value.eligibleMemberIds.filter((entry) => typeof entry === "string")
      : undefined,
  } satisfies CombatTurnState;
}

function normalizeBossNextIntent(value?: BossNextIntent | null) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    skillId: typeof value.skillId === "string" ? value.skillId : null,
    skillName: typeof value.skillName === "string" ? value.skillName : null,
    targetType: value.targetType === "all_enemies" || value.targetType === "single" ? value.targetType : undefined,
  } satisfies BossNextIntent;
}

function normalizeBossCounterResults(value?: BossCounterResult[] | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const playerId = typeof entry.playerId === "string" ? entry.playerId : "";
      const playerName = typeof entry.playerName === "string" ? entry.playerName : "队友";
      const damage = Math.max(0, Number(entry.damage || 0));
      const slot = typeof entry.slot === "number" ? entry.slot : null;

      if (!playerId || damage <= 0) {
        return null;
      }

      return {
        playerId,
        playerName,
        slot,
        damage,
        currentHp: typeof entry.currentHp === "number" ? Math.max(0, Number(entry.currentHp)) : undefined,
        died: Boolean(entry.died),
      } satisfies BossCounterResult;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function buildPartyCombatQuery(partyCombatId?: string | null) {
  const normalized = typeof partyCombatId === "string" ? partyCombatId.trim() : "";
  return normalized ? `?partyCombatId=${encodeURIComponent(normalized)}` : "";
}

function clampPercent(current: number, max: number) {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function getFallbackText(name: string) {
  const compact = name.replace(/\s+/g, "");
  return compact ? compact.slice(0, Math.min(2, compact.length)) : "修士";
}

function buildRecoveryParts(recoveredHp: number, recoveredMp: number) {
  const parts: string[] = [];
  if (recoveredHp > 0) {
    parts.push(`恢复气血 ${recoveredHp}`);
  }
  if (recoveredMp > 0) {
    parts.push(`恢复灵力 ${recoveredMp}`);
  }
  return parts;
}

function formatActionLog(params: {
  playerName: string;
  actionType?: "skill" | "item";
  skillName?: string;
  skillOutcome?: "damage" | "heal" | "utility";
  damage?: number;
  recoveredHp?: number;
  recoveredMp?: number;
}) {
  const playerName = params.playerName || "道友";
  const skillName = params.skillName || (params.actionType === "item" ? "丹药" : "神通");
  const damage = Math.max(0, Number(params.damage || 0));
  const recoveredHp = Math.max(0, Number(params.recoveredHp || 0));
  const recoveredMp = Math.max(0, Number(params.recoveredMp || 0));
  const recoveryParts = buildRecoveryParts(recoveredHp, recoveredMp);

  if (params.actionType === "item") {
    return recoveryParts.length
      ? `${playerName} 使用 ${skillName}，${recoveryParts.join("，")}`
      : `${playerName} 使用 ${skillName}，但没有触发可见回复`;
  }

  if (params.skillOutcome === "heal" || params.skillOutcome === "utility") {
    return recoveryParts.length
      ? `${playerName} 施展 ${skillName}，${recoveryParts.join("，")}`
      : `${playerName} 施展 ${skillName}，状态发生变化`;
  }

  if (damage > 0) {
    return `${playerName} 施展 ${skillName}，对首领造成 ${damage} 点伤害`;
  }

  return `${playerName} 施展 ${skillName}，但未造成有效伤害`;
}

function formatBossCounterLog(targetName: string, damage: number, skillName?: string | null, died = false) {
  if (damage <= 0) {
    return "";
  }
  const counterName = skillName?.trim() ? `首领反击【${skillName.trim()}】` : "首领反击";
  return `${counterName}，对${targetName}造成 ${damage} 点伤害${died ? "，并将其击倒" : ""}`;
}

function getStageStatusText(bossHp: number, respawnRemainingSeconds: number) {
  if (bossHp > 0) {
    return "战斗进行中";
  }
  if (respawnRemainingSeconds > 0) {
    return `首领重生倒计时 ${respawnRemainingSeconds}s`;
  }
  return "等待首领重生";
}

function getRoomSummary(params: {
  bossHp: number;
  joined: boolean;
  roomFull: boolean;
  mySlot: number | null;
  respawnRemainingSeconds: number;
}) {
  if (params.bossHp <= 0) {
    return params.respawnRemainingSeconds > 0
      ? `首领正在恢复灵压，约 ${params.respawnRemainingSeconds} 秒后重返战场。`
      : "首领尚未现身，稍候即可重新入场。";
  }

  if (params.joined) {
    return params.mySlot !== null
      ? `你已自动入场，当前位于席位 ${params.mySlot + 1}。`
      : "你已在战场中，可以继续出手。";
  }

  if (params.roomFull) {
    return "当前席位已满，你现在处于观战状态。";
  }

  return "当前仍有空位，保持在线会自动补位。";
}

function BossTurnPanel({
  currentTurnText,
  countdownText,
  intentText,
  badgeText,
  isActive,
  compact = false,
}: {
  currentTurnText: string;
  countdownText: string;
  intentText: string;
  badgeText: string;
  isActive: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`boss-turn-panel ${compact ? "is-compact" : ""} ${isActive ? "is-active" : ""}`}>
      <div className="boss-turn-panel-head">
        <span className="boss-turn-panel-title">共享回合</span>
        <span className={`boss-turn-panel-badge ${isActive ? "is-active" : ""}`}>{badgeText}</span>
      </div>
      <div className="boss-turn-panel-grid">
        <div className="boss-turn-panel-item">
          <span className="boss-turn-panel-label">当前轮到</span>
          <strong>{currentTurnText}</strong>
        </div>
        <div className="boss-turn-panel-item">
          <span className="boss-turn-panel-label">倒计时</span>
          <strong>{countdownText}</strong>
        </div>
        <div className="boss-turn-panel-item">
          <span className="boss-turn-panel-label">首领下回合</span>
          <strong>{intentText}</strong>
        </div>
      </div>
    </div>
  );
}

function BossCompactStatBar({
  label,
  current,
  max,
  fillClassName,
}: {
  label: string;
  current: number;
  max: number;
  fillClassName: string;
}) {
  return (
    <div className="boss-compact-meter">
      <div className="boss-compact-meter-row">
        <span className="boss-compact-meter-label">{label}</span>
        <span className="boss-compact-meter-value">{current}/{max}</span>
      </div>
      <div className="boss-compact-meter-track">
        <div className={["boss-compact-meter-fill", fillClassName].join(" ")} style={{ width: `${clampPercent(current, max)}%` }} />
      </div>
    </div>
  );
}

function BossCompactStatusCard({
  slotTitle,
  name,
  badge,
  hp,
  maxHp,
  mp,
  maxMp,
  className,
}: {
  slotTitle: string;
  name: string;
  badge?: string | null;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  className?: string;
}) {
  return (
    <article className={["boss-compact-card", className || ""].filter(Boolean).join(" ")}>
      <div className="boss-compact-card-head">
        <div className="boss-compact-card-title-wrap">
          <span className="boss-compact-card-slot">{slotTitle}</span>
          <span className="boss-compact-card-name">{name}</span>
        </div>
        {badge ? <span className="boss-compact-card-badge">{badge}</span> : null}
      </div>
      <div className="boss-compact-card-main">
        <div className="boss-compact-card-meters">
          <BossCompactStatBar label="气血" current={hp} max={maxHp} fillClassName="boss-compact-meter-fill--hp" />
          <BossCompactStatBar label="灵力" current={mp} max={maxMp} fillClassName="boss-compact-meter-fill--mp" />
        </div>
      </div>
    </article>
  );
}

export default function BossBattlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: monsterId } = use(params);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { modal } = App.useApp();
  const [messageApi, contextHolder] = message.useMessage();
  const initialPartyCombatId = searchParams.get("partyCombatId")?.trim() || "";

  const [bossData, setBossData] = useState<BossDetail | null>(null);
  const [bossHp, setBossHp] = useState(0);
  const [bossMaxHp, setBossMaxHp] = useState(0);
  const [respawnRemainingSeconds, setRespawnRemainingSeconds] = useState(0);
  const [playerId, setPlayerId] = useState("");
  const [playerHp, setPlayerHp] = useState(0);
  const [playerMp, setPlayerMp] = useState(0);
  const [playerMaxHp, setPlayerMaxHp] = useState(0);
  const [playerMaxMp, setPlayerMaxMp] = useState(0);
  const [skillsData, setSkillsData] = useState<Record<string, SkillView>>({});
  const [playerSkills, setPlayerSkills] = useState<string[]>([]);
  const [participants, setParticipants] = useState<BossParticipant[]>([]);
  const [joined, setJoined] = useState(false);
  const [roomFull, setRoomFull] = useState(false);
  const [canAttack, setCanAttack] = useState(false);
  const [mySlot, setMySlot] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [attacking, setAttacking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logExpanded, setLogExpanded] = useState(false);
  const [activeMotion, setActiveMotion] = useState<BossMotionState | null>(null);
  const [popups, setPopups] = useState<BossPopupState[]>([]);
  const [sceneSnapshot, setSceneSnapshot] = useState<BattleSceneSnapshot | null>(null);
  const [turnState, setTurnState] = useState<CombatTurnState | null>(null);
  const [bossNextIntent, setBossNextIntent] = useState<BossNextIntent | null>(null);
  const [turnNowMs, setTurnNowMs] = useState(() => Date.now());
  const [activePartyCombatId, setActivePartyCombatId] = useState(initialPartyCombatId);
  const [bossUnavailableMessage, setBossUnavailableMessage] = useState<string | null>(null);
  const [battleView, setBattleView] = useState<BattleViewState | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const rewardShownRef = useRef(false);
  const motionIdRef = useRef(0);
  const popupIdRef = useRef(0);
  const timerRef = useRef<number[]>([]);
  const nextClientSequenceRef = useRef(1);
  const participantsRef = useRef<BossParticipant[]>([]);
  const playerIdRef = useRef("");
  const activePartyCombatIdRef = useRef(activePartyCombatId);
  const sceneSnapshotRef = useRef<BattleSceneSnapshot | null>(null);
  const repairRequestPendingRef = useRef(false);
  const lastRepairRequestKeyRef = useRef("");
  const turnAdvanceInFlightRef = useRef(false);
  const lastAutoAdvanceKeyRef = useRef("");
  const lastColyseusTimelineKeyRef = useRef("");
  const pageVisibleRef = useRef(true);
  const leavingBossPageRef = useRef(false);

  useEffect(() => {
    activePartyCombatIdRef.current = initialPartyCombatId;
    setActivePartyCombatId(initialPartyCombatId);
  }, [initialPartyCombatId]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    activePartyCombatIdRef.current = activePartyCombatId;
  }, [activePartyCombatId]);

  useEffect(() => {
    sceneSnapshotRef.current = sceneSnapshot;
  }, [sceneSnapshot]);

  const activeParticipants = useMemo(
    () => participants.slice().sort((left, right) => left.slot - right.slot),
    [participants],
  );
  const bossEntityId = `boss-${monsterId}`;
  const highlightedParticipantId = turnState?.currentTurnPlayerId || playerId;
  const selfParticipant = useMemo(
    () => activeParticipants.find((participant) => participant.playerId === playerId) || null,
    [activeParticipants, playerId],
  );
  const selfSkillCooldowns = selfParticipant?.skillCooldowns || {};
  const bossHudSlots = useMemo<BossHudSlot[]>(() => {
    const selfBadge = playerHp <= 0
      ? "已倒下"
      : highlightedParticipantId === playerId
        ? "当前回合"
        : joined
          ? "你"
          : roomFull
            ? "观战"
            : "待补位";
    const teammateSlots = activeParticipants
      .filter((participant) => participant.playerId !== playerId)
      .slice(0, 2)
      .map((participant) => ({
        key: participant.playerId,
        slotTitle: `${participant.slot + 1} 号位`,
        badge: participant.hp <= 0
          ? "已倒下"
          : participant.playerId === highlightedParticipantId
            ? "当前回合"
            : "待命",
        name: participant.playerName,
        hp: participant.hp,
        maxHp: participant.maxHp,
        mp: participant.mp,
        maxMp: participant.maxMp,
        avatarImageUrl: participant.avatarImageUrl,
        avatarFrameImageUrl: participant.avatarFrameImageUrl,
        fallbackText: getFallbackText(participant.playerName),
        className: participant.playerId === highlightedParticipantId ? "is-current" : "",
        isEmpty: false,
      }));

    const slots: BossHudSlot[] = [
      {
        key: "self",
        slotTitle: "自身",
        badge: selfBadge,
        name: selfParticipant?.playerName || "你",
        hp: playerHp,
        maxHp: playerMaxHp,
        mp: playerMp,
        maxMp: playerMaxMp,
        avatarImageUrl: selfParticipant?.avatarImageUrl,
        avatarFrameImageUrl: selfParticipant?.avatarFrameImageUrl,
        fallbackText: getFallbackText(selfParticipant?.playerName || "你"),
        className: ["is-self", highlightedParticipantId === playerId ? "is-current" : ""].filter(Boolean).join(" "),
        isEmpty: false,
      },
      ...teammateSlots,
    ];

    while (slots.length < 3) {
      slots.push({
        key: `empty-${slots.length}`,
        slotTitle: "空位",
        badge: null,
        name: "待组队道友",
        hp: 0,
        maxHp: 0,
        mp: 0,
        maxMp: 0,
        avatarImageUrl: null,
        avatarFrameImageUrl: null,
        fallbackText: "空位",
        className: "is-empty",
        isEmpty: true,
      });
    }

    return slots;
  }, [activeParticipants, highlightedParticipantId, joined, playerHp, playerId, playerMaxHp, playerMaxMp, playerMp, roomFull, selfParticipant]);

  const stageUnits = useMemo(() => {
    if (!bossData) {
      return [];
    }

    return [
      {
        id: bossEntityId,
        name: bossData.name,
        role: "boss" as const,
        avatarImageUrl: bossData.avatarImageUrl,
        fallbackText: getFallbackText(bossData.name),
        isDead: bossHp <= 0,
        hp: bossHp,
        maxHp: bossMaxHp,
      },
      ...activeParticipants.map((participant) => ({
        id: participant.playerId,
        name: participant.playerName,
        role: "player" as const,
        slot: participant.slot,
        avatarImageUrl: participant.avatarImageUrl,
        avatarFrameImageUrl: participant.avatarFrameImageUrl,
        fallbackText: getFallbackText(participant.playerName),
        isCurrent: participant.playerId === highlightedParticipantId,
        isDead: participant.hp <= 0,
        hp: participant.hp,
        maxHp: participant.maxHp,
        mp: participant.mp,
        maxMp: participant.maxMp,
        activeEffects: participant.activeEffects,
      })),
    ];
  }, [activeParticipants, bossData, bossEntityId, bossHp, bossMaxHp, highlightedParticipantId]);

  const stageAnchorMap = useBattleSceneRenderAnchorMap({
    mode: "boss",
    units: stageUnits,
    sceneSnapshot,
  });

  const stageMotion = useMemo(() => {
    if (!activeMotion) {
      return null;
    }

    const actorId = activeMotion.actorSide === "boss"
      ? bossEntityId
      : activeParticipants.find((participant) => participant.slot === activeMotion.actorSlot)?.playerId;
    const targetId = activeMotion.targetSide === "boss"
      ? bossEntityId
      : activeParticipants.find((participant) => participant.slot === activeMotion.targetSlot)?.playerId;

    const resolvedActorId = actorId || targetId;
    const resolvedTargetId = targetId || actorId;
    if (!resolvedActorId || !resolvedTargetId) {
      return null;
    }

    return {
      id: activeMotion.id,
      actorId: resolvedActorId,
      targetId: resolvedTargetId,
      visualEffect: activeMotion.visualEffect,
      durationMs: Math.max(420, getSkillVisualEffectDurationMs(activeMotion.visualEffect) + 110),
    };
  }, [activeMotion, activeParticipants, bossEntityId]);

  const backdropUnits = useMemo(() => {
    if (!bossData) {
      return [];
    }

    return [
      {
        id: bossEntityId,
        role: "boss" as const,
        isActor: activeMotion?.actorSide === "boss",
        isTarget: activeMotion?.targetSide === "boss",
      },
      ...activeParticipants.map((participant) => ({
        id: participant.playerId,
        role: "player" as const,
        slot: participant.slot,
        isCurrent: participant.playerId === highlightedParticipantId,
        isActor: activeMotion?.actorSide === "player" && activeMotion.actorSlot === participant.slot,
        isTarget: activeMotion?.targetSide === "player" && activeMotion.targetSlot === participant.slot,
      })),
    ];
  }, [activeMotion, activeParticipants, bossData, bossEntityId, highlightedParticipantId]);

  const stageStatusText = getStageStatusText(bossHp, respawnRemainingSeconds);
  const resolvedBattleView = useMemo(() => {
    if (!bossData) {
      return battleView;
    }

    return buildBossBattleViewState({
      runtimeId: monsterId,
      bossName: bossData.name,
      currentHp: bossHp,
      maxHp: bossMaxHp || bossData.hp || 0,
      participants: activeParticipants,
      turnState,
      sceneSnapshot,
      viewerPlayerId: playerId || null,
      statusText: stageStatusText,
      modePayload: battleView?.modePayload || null,
    });
  }, [activeParticipants, battleView, bossData, bossHp, bossMaxHp, monsterId, playerId, sceneSnapshot, stageStatusText, turnState]);
  const roomSummary = getRoomSummary({
    bossHp,
    joined,
    roomFull,
    mySlot,
    respawnRemainingSeconds,
  });
  const hasSharedTurnState = Boolean(
    turnState
    && (turnState.currentTurnPlayerId || turnState.turnDeadlineAt || turnState.turnOrder.length > 0),
  );
  const isCurrentTurn = !hasSharedTurnState || Boolean(playerId && turnState?.currentTurnPlayerId === playerId);
  const turnDeadlineAtMs = turnState?.turnDeadlineAt ? Date.parse(turnState.turnDeadlineAt) : Number.NaN;
  const turnDeadlineMs = Number.isFinite(turnDeadlineAtMs) ? Math.max(0, turnDeadlineAtMs - turnNowMs) : 0;
  const bossQuery = buildPartyCombatQuery(activePartyCombatId);
  const turnCountdownText = hasSharedTurnState && turnState?.turnDeadlineAt
    ? `${Math.max(0, Math.ceil(turnDeadlineMs / 1000))}s`
    : "--";
  const resolvedCurrentTurnPlayerName = activeParticipants.find((participant) => participant.playerId === turnState?.currentTurnPlayerId)?.playerName;
  const currentTurnPlayerName = turnState?.currentTurnPlayerId === playerId ? "你" : (resolvedCurrentTurnPlayerName || "队友");
  const sharedTurnText = hasSharedTurnState ? `共享回合 ${Number(turnState?.turnIndex || 0) + 1}` : null;
  const turnOwnerText = hasSharedTurnState
    ? (turnState?.currentTurnPlayerId ? (isCurrentTurn ? "轮到你" : `轮到 ${currentTurnPlayerName}`) : "等待系统推进")
    : "实时出手";
  const bossIntentTargetText = bossNextIntent?.targetType === "all_enemies"
    ? "全体"
    : bossNextIntent?.targetType === "single"
      ? "单体"
      : "";
  const bossIntentText = bossNextIntent?.skillName || bossNextIntent?.skillId || "";
  const bossIntentSummaryText = bossIntentText
    ? `${bossIntentText}${bossIntentTargetText ? ` · ${bossIntentTargetText}` : ""}`
    : "暂未显露";
  const turnPanelBadgeText = hasSharedTurnState ? (isCurrentTurn && canAttack ? "你可操作" : "等待中") : "战局更新";
  const seatStatusText = joined ? (mySlot !== null ? `席位 ${mySlot + 1}` : "已入场") : roomFull ? "观战中" : "待补位";
  const rosterSlots = useMemo(
    () => Array.from({ length: 3 }, (_, slot) => activeParticipants.find((participant) => participant.slot === slot) || null),
    [activeParticipants],
  );
  function buildActionHint(params: {
    attacking: boolean;
    bossHp: number;
    playerHp: number;
    joined: boolean;
    roomFull: boolean;
    canAttack: boolean;
    hasSharedTurnState: boolean;
    isCurrentTurn: boolean;
    currentTurnPlayerName: string;
    turnCountdownText: string;
    bossIntentText: string;
  }) {
    if (params.attacking) {
      return "动作结算中，请稍候。";
    }
    if (params.bossHp <= 0) {
      return "首领未现身，暂时不能出手。";
    }
    if (params.playerHp <= 0) {
      return "角色已离场，正在等待跳转。";
    }
    if (!params.joined && params.roomFull) {
      return "当前房间已满，你正在观战。";
    }
    if (!params.joined) {
      return "等待自动补位后即可出手。";
    }
    if (params.hasSharedTurnState && !params.isCurrentTurn) {
      return `等待 ${params.currentTurnPlayerName} 出手，剩余 ${params.turnCountdownText}。${params.bossIntentText ? `首领蓄势：${params.bossIntentText}` : "首领意图尚未显露。"}`;
    }
    if (params.hasSharedTurnState && !params.canAttack) {
      return `当前轮到你，但此刻不可出手。${params.bossIntentText ? `首领蓄势：${params.bossIntentText}` : "请等待战局刷新。"}`;
    }
    if (params.hasSharedTurnState) {
      return `当前轮到你出手，剩余 ${params.turnCountdownText}。${params.bossIntentText ? `首领蓄势：${params.bossIntentText}` : "抓紧决策。"}`;
    }
    if (!params.canAttack) {
      return "当前不可出手。";
    }
    return "技能和丹药都可以直接点击释放。";
  }

  const actionHint = buildActionHint({
    attacking,
    bossHp,
    playerHp,
    joined,
    roomFull,
    canAttack,
    hasSharedTurnState,
    isCurrentTurn,
    currentTurnPlayerName,
    turnCountdownText,
    bossIntentText: bossIntentSummaryText,
  });
  const latestLog = log.length ? log[log.length - 1] : (bossData?.description || "等待战斗开始");
  const logSummary = logExpanded ? `共 ${log.length} 条战报` : latestLog;
  const isWaitingState = bossHp <= 0;
  const actionDisabled = attacking || bossHp <= 0 || playerHp <= 0 || !canAttack || !joined || (hasSharedTurnState && !isCurrentTurn);
  const skillEntries = playerSkills
    .map((skillId) => ({
      id: skillId,
      skill: skillsData[skillId],
      cooldownLeft: Number(selfSkillCooldowns[skillId] || 0),
    }))
    .filter((entry): entry is { id: string; skill: SkillView; cooldownLeft: number } => Boolean(entry.skill));
  const bossTopBannerBadges = [
    stageStatusText,
    seatStatusText,
    sharedTurnText,
    hasSharedTurnState ? `倒计时 ${turnCountdownText}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  const renderBossActionPanel = (className = "combat-action-panel") => (
    <BattleActionPanel
      className={className}
      title="首领出手"
      subtitle={actionHint}
      statusLabel={actionDisabled ? "等待中" : "可出手"}
      statusHighlighted={Boolean(hasSharedTurnState && isCurrentTurn && canAttack)}
      commandButtons={[
        {
          key: "refresh",
          label: "刷新战局",
          disabled: leavingBossPageRef.current || attacking,
          onClick: () => {
            void fetchBossData(false);
          },
        },
        {
          key: "leave",
          label: "退出战场",
          tone: "danger",
          disabled: leavingBossPageRef.current,
          onClick: () => leaveBossPage("正在退出战场并返回地图。"),
        },
      ]}
      skillSectionTitle="首领神通"
      skillSectionHint={joined ? (hasSharedTurnState ? "按回合出手" : "实时点击释放") : "等待补位"}
      skills={skillEntries.map(({ id, skill, cooldownLeft }) => ({
        key: id,
        tag: cooldownLeft > 0
          ? `冷却 ${cooldownLeft}`
          : `MP ${skill.mpCost || 0}`,
        disabled: actionDisabled || cooldownLeft > 0 || playerMp < (skill.mpCost || 0),
        onClick: () => handleSkillAction(id),
        content: (
          <>
            <ThunderboltOutlined />
            <span>{skill.name}</span>
          </>
        ),
      }))}
      itemSectionTitle="即时丹药"
      itemSectionHint={formatInventorySyncHint(combatInventoryRefreshedAt)}
      items={combatConsumables.map((item) => ({
        key: item.itemId,
        disabled: actionDisabled,
        onClick: () => handleItemAction(item.itemId),
        content: (
          <>
            <ItemIcon iconUrl={item.iconUrl} size={18} />
            <span>{item.name}</span>
          </>
        ),
        meta: `剩余 ${item.quantity}`,
      }))}
    />
  );

  const appendLog = useCallback((entry: string) => {
    setLog((current) => [...current.slice(-79), entry]);
  }, []);

  const scheduleTimer = useCallback((callback: () => void, delayMs: number) => {
    const timerId = window.setTimeout(() => {
      timerRef.current = timerRef.current.filter((id) => id !== timerId);
      callback();
    }, delayMs);
    timerRef.current.push(timerId);
    return timerId;
  }, []);

  const pushPopup = useCallback((params: {
    targetSide: BossStageSide;
    targetSlot?: number | null;
    label: string;
    kind: "damage" | "heal";
    delayMs?: number;
  }) => {
    scheduleTimer(() => {
      const popupId = popupIdRef.current + 1;
      popupIdRef.current = popupId;
      setPopups((current) => [
        ...current,
        {
          id: popupId,
          targetSide: params.targetSide,
          targetSlot: params.targetSlot ?? null,
          label: params.label,
          kind: params.kind,
        },
      ]);

      scheduleTimer(() => {
        setPopups((current) => current.filter((popup) => popup.id !== popupId));
      }, 1100);
    }, params.delayMs ?? 0);
  }, [scheduleTimer]);

  const triggerMotion = useCallback((params: {
    actorSide: BossStageSide;
    actorSlot?: number | null;
    targetSide: BossStageSide;
    targetSlot?: number | null;
    visualEffect?: CombatSkillVisualEffect | null;
    delayMs?: number;
  }) => {
    scheduleTimer(() => {
      const motionId = motionIdRef.current + 1;
      motionIdRef.current = motionId;
      setActiveMotion({
        id: motionId,
        actorSide: params.actorSide,
        actorSlot: params.actorSlot ?? null,
        targetSide: params.targetSide,
        targetSlot: params.targetSlot ?? null,
        visualEffect: params.visualEffect || null,
      });

      const motionDuration = Math.max(420, getSkillVisualEffectDurationMs(params.visualEffect) + 110);
      scheduleTimer(() => {
        setActiveMotion((current) => current?.id === motionId ? null : current);
      }, motionDuration);
    }, params.delayMs ?? 0);
  }, [scheduleTimer]);

  const notifyReward = useCallback((rewards?: RewardView[] | null) => {
    if (rewardShownRef.current || !playerId || !Array.isArray(rewards)) {
      return;
    }

    const myReward = rewards.find((item) => item.playerId === playerId);
    if (!myReward) {
      return;
    }

    rewardShownRef.current = true;
    if (myReward.noRewardReason === "stamina_empty") {
      modal.warning({
        title: "首领战斗结算",
        content: "你参与了本次首领战，但体力不足，未获得奖励。",
        okText: "关闭",
      });
      return;
    }

    modal.success({
      title: "首领战斗结算",
      okText: "关闭",
      content: (
        <div className="boss-settle-content">
          <p>获得修为：{myReward.xp}</p>
          <p>获得灵石：{myReward.gold}</p>
          {myReward.drops?.length ? (
            <div>
              <p>掉落物品：</p>
              <div className="boss-drop-list">
                <RewardDropList drops={myReward.drops} iconSize={16} />
              </div>
            </div>
          ) : (
            <p>掉落物品：无</p>
          )}
        </div>
      ),
    });
  }, [modal, playerId]);

  const syncPartyCombatId = useCallback((nextPartyCombatId?: string | null, replaceUrl = false) => {
    const normalized = typeof nextPartyCombatId === "string" ? nextPartyCombatId.trim() : "";
    if (!normalized) {
      return;
    }

    activePartyCombatIdRef.current = normalized;
    setActivePartyCombatId((current) => current === normalized ? current : normalized);
    if (!replaceUrl || searchParams.get("partyCombatId") === normalized) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("partyCombatId", normalized);
    router.replace(nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname);
  }, [pathname, router, searchParams]);

  const resetRealtimeRepairState = useCallback(() => {
    repairRequestPendingRef.current = false;
    lastRepairRequestKeyRef.current = "";
  }, []);

  const applyBossCounterFeedback = useCallback((params: {
    counterResults?: BossCounterResult[] | null;
    counterSkillName?: string | null;
    fallbackDamage?: number;
    fallbackTargetPlayerId?: string;
    fallbackTargetName?: string;
    fallbackTargetSlot?: number | null;
  }) => {
    const normalizedResults = normalizeBossCounterResults(params.counterResults);
    const fallbackDamage = Math.max(0, Number(params.fallbackDamage || 0));
    const fallbackTarget = params.fallbackTargetPlayerId
      ? participantsRef.current.find((participant) => participant.playerId === params.fallbackTargetPlayerId)
      : null;

    const results = normalizedResults.length
      ? normalizedResults
      : fallbackDamage > 0
        ? [{
            playerId: params.fallbackTargetPlayerId || playerIdRef.current,
            playerName: params.fallbackTargetName || fallbackTarget?.playerName || "队友",
            slot: typeof params.fallbackTargetSlot === "number" ? params.fallbackTargetSlot : fallbackTarget?.slot,
            damage: fallbackDamage,
            currentHp: undefined,
            died: false,
          } satisfies BossCounterResult]
        : [];

    if (!results.length) {
      return;
    }

    setParticipants((current) => current.map((participant) => {
      const hit = results.find((entry) => entry.playerId === participant.playerId);
      if (!hit) {
        return participant;
      }

      return {
        ...participant,
        hp: typeof hit.currentHp === "number" ? hit.currentHp : Math.max(0, participant.hp - hit.damage),
      };
    }));

    results.forEach((result, index) => {
      const targetSlot = typeof result.slot === "number"
        ? result.slot
        : participantsRef.current.find((participant) => participant.playerId === result.playerId)?.slot ?? null;
      const delayMs = index * 140;

      triggerMotion({
        actorSide: "boss",
        targetSide: "player",
        targetSlot,
        delayMs: 220 + delayMs,
      });
      pushPopup({
        targetSide: "player",
        targetSlot,
        label: `-${result.damage}`,
        kind: "damage",
        delayMs: 340 + delayMs,
      });

      const targetName = result.playerId === playerIdRef.current ? "你" : result.playerName;
      const counterLog = formatBossCounterLog(targetName, result.damage, params.counterSkillName, Boolean(result.died));
      if (counterLog) {
        appendLog(counterLog);
      }

      if (result.playerId === playerIdRef.current) {
        if (typeof result.currentHp === "number") {
          setPlayerHp(result.currentHp);
        }
        if (result.died) {
          setCanAttack(false);
          setJoined(false);
        }
      }
    });
  }, [appendLog, pushPopup, triggerMotion]);

  const applyTurnExtras = useCallback((payload?: {
    turnState?: CombatTurnState | null;
    bossNextIntent?: BossNextIntent | null;
  }) => {
    if (!payload) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "turnState")) {
      setTurnState(normalizeTurnState(payload.turnState));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "bossNextIntent")) {
      setBossNextIntent(normalizeBossNextIntent(payload.bossNextIntent));
    }
  }, []);

  const applyBossRuntimeUpdate = useCallback((payload?: {
    bossHp?: number;
    bossMaxHp?: number;
    playerHp?: number;
    playerMp?: number;
    playerMaxHp?: number;
    playerMaxMp?: number;
    respawnRemainingSeconds?: number;
    participants?: BossParticipant[];
    joined?: boolean;
    roomFull?: boolean;
    canAttack?: boolean;
    mySlot?: number | null;
    partyCombatId?: string | null;
    sceneSnapshot?: BattleSceneSnapshot | null;
    battleView?: BattleViewState | null;
    turnState?: CombatTurnState | null;
    bossNextIntent?: BossNextIntent | null;
  }) => {
    if (!payload) {
      return;
    }

    if (typeof payload.bossHp === "number") {
      setBossHp(payload.bossHp);
    }
    if (typeof payload.bossMaxHp === "number") {
      setBossMaxHp(payload.bossMaxHp);
    }
    if (typeof payload.playerHp === "number") {
      setPlayerHp(payload.playerHp);
    }
    if (typeof payload.playerMp === "number") {
      setPlayerMp(payload.playerMp);
    }
    if (typeof payload.playerMaxHp === "number") {
      setPlayerMaxHp(payload.playerMaxHp);
    }
    if (typeof payload.playerMaxMp === "number") {
      setPlayerMaxMp(payload.playerMaxMp);
    }
    if (typeof payload.respawnRemainingSeconds === "number") {
      setRespawnRemainingSeconds(Math.max(0, Number(payload.respawnRemainingSeconds || 0)));
    }
    if (Array.isArray(payload.participants)) {
      setParticipants(payload.participants);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "sceneSnapshot")) {
      const nextSceneSnapshot = materializeBattleSceneSnapshot(
        sceneSnapshotRef.current,
        payload.sceneSnapshot || null,
      );
      if (nextSceneSnapshot) {
        resetRealtimeRepairState();
        sceneSnapshotRef.current = nextSceneSnapshot;
        setSceneSnapshot(nextSceneSnapshot);
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "joined")) {
      setJoined(Boolean(payload.joined));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "roomFull")) {
      setRoomFull(Boolean(payload.roomFull));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "canAttack")) {
      setCanAttack(Boolean(payload.canAttack));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "mySlot")) {
      setMySlot(typeof payload.mySlot === "number" ? payload.mySlot : null);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "partyCombatId")) {
      syncPartyCombatId(payload.partyCombatId);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "battleView")) {
      setBattleView(payload.battleView || null);
    }

    applyTurnExtras(payload);
  }, [applyTurnExtras, resetRealtimeRepairState, syncPartyCombatId]);

  const applyBossPayload = useCallback((payload?: BossApiResponse["data"]) => {
    if (!payload) {
      return;
    }

    setBossData(payload.monster);
    if (payload.instance) {
      setBossHp(payload.instance.currentHp);
      setBossMaxHp(payload.instance.maxHp);
    } else {
      setBossHp(0);
      setBossMaxHp(payload.monster.hp || 0);
    }
    setRespawnRemainingSeconds(Math.max(0, Number(payload.respawnRemainingSeconds || 0)));
    setParticipants(Array.isArray(payload.participants) ? payload.participants : []);
    const nextSceneSnapshot = materializeBattleSceneSnapshot(null, payload.sceneSnapshot || null);
    resetRealtimeRepairState();
    sceneSnapshotRef.current = nextSceneSnapshot;
    setSceneSnapshot(nextSceneSnapshot);
    setJoined(Boolean(payload.joined));
    setRoomFull(Boolean(payload.roomFull));
    setCanAttack(Boolean(payload.canAttack));
    setMySlot(typeof payload.mySlot === "number" ? payload.mySlot : null);
    setPlayerId(payload.player.id);
    setPlayerHp(payload.player.hp);
    setPlayerMaxHp(payload.player.maxHp);
    setPlayerMp(payload.player.mp);
    setPlayerMaxMp(payload.player.maxMp);
    setPlayerSkills(payload.player.skills);
    setSkillsData(payload.skillsData || {});
    setBattleView(payload.battleView || null);
    applyTurnExtras(payload);
    syncPartyCombatId(payload.partyCombatId, true);

    if (payload.instance?.currentHp && payload.instance.currentHp > 0) {
      rewardShownRef.current = false;
    }
  }, [applyTurnExtras, resetRealtimeRepairState, syncPartyCombatId]);

  const leaveBossPage = useCallback((messageText?: string) => {
    if (leavingBossPageRef.current) {
      return;
    }
    const fallbackMessage = messageText || "该首领已失效，正在尝试退出秘境并返回地图。";
    const invalidEncounterRoutePath = buildPartyBossEncounterRoutePath(monsterId, activePartyCombatId);
    leavingBossPageRef.current = true;
    pageVisibleRef.current = false;
    setBossUnavailableMessage(fallbackMessage);
    setLoading(false);
    setAttacking(false);
    setJoined(false);
    setRoomFull(false);
    setCanAttack(false);
    setBossData(null);
    setBossNextIntent(null);
    setTurnState(null);
    setRespawnRemainingSeconds(0);
    persistInvalidBossEncounterRedirectGuard({
      encounterId: activePartyCombatId,
      routePath: invalidEncounterRoutePath,
    });
    messageApi.warning(fallbackMessage);
    void fetch("/api/game/secret-realm/leave", {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
    void fetch(`/api/game/boss/${monsterId}${bossQuery}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
    window.setTimeout(() => {
      router.replace("/game/map");
    }, 180);
  }, [activePartyCombatId, bossQuery, messageApi, monsterId, router]);

  const handleBossUnavailable = useCallback((payload?: {
    redirectToMap?: boolean;
    error?: string;
    settled?: boolean;
    bossUnavailableReason?: string;
  } | null, status?: number) => {
    if (!shouldLeaveBossPageOnUnavailable(payload, status)) {
      return false;
    }
    leaveBossPage(payload?.error || "该首领已失效，正在尝试退出秘境并返回地图。");
    return true;
  }, [leaveBossPage]);

  const fetchBossData = useCallback(async (silent = false) => {
    if (leavingBossPageRef.current) {
      return;
    }
    try {
      const response = await fetch(`/api/game/boss/${monsterId}${bossQuery}`, {
        cache: "no-store",
      });
      const json = await readBossApiResponse<BossApiResponse>(response);
      if (handleBossUnavailable(json, response.status)) {
        return;
      }
      if (!json.success || !json.data) {
        if (!silent) {
          messageApi.error(json.error || "当前无法获取首领战场信息");
        }
        return;
      }
      applyBossPayload(json.data);
    } catch {
      if (!silent && !leavingBossPageRef.current) {
        messageApi.error("战场信息获取失败，请稍后重试");
      }
    }
  }, [applyBossPayload, bossQuery, handleBossUnavailable, messageApi, monsterId]);

  const createBossActionRequestMeta = useCallback(() => {
    const clientSequence = nextClientSequenceRef.current;
    nextClientSequenceRef.current += 1;
    return createActionRequestMeta({
      clientSequence,
      clientSceneTick: sceneSnapshotRef.current?.tick ?? 0,
    });
  }, []);

  const restoreBossClientSequence = useCallback((acceptedClientSequence?: number) => {
    if (typeof acceptedClientSequence !== "number" || !Number.isFinite(acceptedClientSequence)) {
      return;
    }
    nextClientSequenceRef.current = Math.max(1, Math.floor(acceptedClientSequence) + 1);
  }, []);

  const bossColyseusRoom = useCombatColyseusRoom({
    enabled: Boolean(bossData && playerId && !leavingBossPageRef.current),
    roomName: GAME_ROOM_NAMES.boss,
    combatId: monsterId,
    playerId,
    partyId: activePartyCombatId || null,
    initialSequence: nextClientSequenceRef.current,
  });

  const applyBossColyseusEnvelope = useCallback((envelope: CombatSceneEnvelope | null) => {
    if (!envelope) {
      return;
    }

    const authoritativeState = envelope.authoritativeState;
    const bossEntity = authoritativeState.entities.find((entity) => entity.role === "boss" || entity.id.startsWith("boss:"));
    const nextParticipants = Array.isArray(authoritativeState.participants)
      ? authoritativeState.participants as BossParticipant[]
      : undefined;
    const selfParticipant = nextParticipants?.find((participant) => participant.playerId === playerId);

    applyBossRuntimeUpdate({
      bossHp: typeof bossEntity?.hp === "number" ? bossEntity.hp : undefined,
      bossMaxHp: typeof bossEntity?.maxHp === "number" ? bossEntity.maxHp : undefined,
      playerHp: typeof selfParticipant?.hp === "number" ? selfParticipant.hp : undefined,
      playerMp: typeof selfParticipant?.mp === "number" ? selfParticipant.mp : undefined,
      playerMaxHp: typeof selfParticipant?.maxHp === "number" ? selfParticipant.maxHp : undefined,
      playerMaxMp: typeof selfParticipant?.maxMp === "number" ? selfParticipant.maxMp : undefined,
      participants: nextParticipants,
      sceneSnapshot: authoritativeState.sceneSnapshot as BattleSceneSnapshot | null | undefined,
      battleView: authoritativeState.battleView as BattleViewState | null | undefined,
      turnState: authoritativeState.turnState as CombatTurnState | null | undefined,
    });
    restoreBossClientSequence(envelope.acceptedSequence ?? undefined);
  }, [applyBossRuntimeUpdate, playerId, restoreBossClientSequence]);

  const playBossColyseusTimelineFeedback = useCallback((envelope: CombatSceneEnvelope | null) => {
    if (!envelope) {
      return;
    }

    for (const event of envelope.events || []) {
      if (event.type !== "timeline_event") {
        continue;
      }
      const timelineKey = [
        envelope.roomId,
        envelope.serverTick,
        event.occurredAt,
        event.actorId,
        event.commandType,
      ].join(":");
      if (lastColyseusTimelineKeyRef.current === timelineKey) {
        continue;
      }
      lastColyseusTimelineKeyRef.current = timelineKey;
      if (event.commandType === "boss_runtime_refresh" || event.commandType === "runtime_refresh") {
        continue;
      }

      const actor = participantsRef.current.find((participant) => participant.playerId === event.actorId);
      if (!actor || actor.playerId === playerIdRef.current) {
        continue;
      }
      triggerMotion({
        actorSide: "player",
        actorSlot: actor.slot,
        targetSide: "boss",
      });
      appendLog(`${actor.playerName || "队友"} 的首领动作已生效。`);
    }
  }, [appendLog, triggerMotion]);

  const sendBossColyseusCommand = useCallback(async <TResponse extends BossActionResponse | BossAdvanceResponse>(
    payload: CombatCommandPayload,
    actionMeta: ReturnType<typeof createActionRequestMeta>,
  ): Promise<TResponse | null> => {
    if (bossColyseusRoom.status !== "connected") {
      return null;
    }

    const result = await bossColyseusRoom.sendCommandAndWaitForAck(payload, {
      ...actionMeta,
      timeoutMs: 5000,
    });
    if (!result) {
      return null;
    }

    restoreBossClientSequence(result.ack.acceptedSequence);
    const authoritativeState = (result.ack.authoritativeState || {}) as Record<string, unknown>;
    return {
      success: result.ack.accepted,
      error: typeof authoritativeState.error === "string"
        ? authoritativeState.error
        : typeof authoritativeState.migrationNote === "string"
          ? authoritativeState.migrationNote
          : result.ack.accepted
            ? undefined
            : "首领实时动作执行失败",
      data: result.ack.accepted ? authoritativeState as TResponse["data"] : undefined,
    } as TResponse;
  }, [bossColyseusRoom, restoreBossClientSequence]);

  useEffect(() => {
    applyBossColyseusEnvelope(bossColyseusRoom.sceneSnapshot);
  }, [applyBossColyseusEnvelope, bossColyseusRoom.sceneSnapshot]);

  useEffect(() => {
    applyBossColyseusEnvelope(bossColyseusRoom.lastTimelineEvent);
    playBossColyseusTimelineFeedback(bossColyseusRoom.lastTimelineEvent);
  }, [applyBossColyseusEnvelope, bossColyseusRoom.lastTimelineEvent, playBossColyseusTimelineFeedback]);

  useEffect(() => {
    applyBossColyseusEnvelope(bossColyseusRoom.lastSettlement);
    if (bossColyseusRoom.lastSettlement) {
      setCanAttack(false);
      appendLog("世界首领战局已结算。");
    }
  }, [appendLog, applyBossColyseusEnvelope, bossColyseusRoom.lastSettlement]);

  const advanceBossTurn = useCallback(async () => {
    if (turnAdvanceInFlightRef.current || leavingBossPageRef.current) {
      return;
    }

    turnAdvanceInFlightRef.current = true;
    try {
      const actionMeta = createBossActionRequestMeta();
      let responseStatus = 200;
      let json = await sendBossColyseusCommand<BossAdvanceResponse>({
        commandType: "timeoutAdvance",
        timeoutAdvance: true,
      }, actionMeta);
      if (!json) {
        responseStatus = 503;
        json = {
          success: false,
          error: "首领战场暂未连接，请稍候再试",
        };
      }
      restoreBossClientSequence(json.data?.acceptedClientSequence || json.data?.commandResult?.acceptedClientSequence);
      if (handleBossUnavailable(json, responseStatus)) {
        return;
      }

      if (json.data) {
        applyBossRuntimeUpdate(json.data);
        if (json.data.bossDead) {
          notifyReward(json.data.rewards || []);
        }
        if (json.data.died) {
          setCanAttack(false);
          setJoined(false);
          if (json.data.message) {
            messageApi.error(json.data.message);
          }
        }
        return;
      }

      if (typeof json.respawnRemainingSeconds === "number" || Array.isArray(json.participants)) {
        applyBossRuntimeUpdate({
          respawnRemainingSeconds: json.respawnRemainingSeconds,
          participants: json.participants,
        });
      }

      if (responseStatus >= 200 && responseStatus < 300) {
        void fetchBossData(true);
      }
    } catch {
      // Ignore deadline advance errors and let the next poll/SSE reconcile state.
    } finally {
      turnAdvanceInFlightRef.current = false;
    }
  }, [applyBossRuntimeUpdate, createBossActionRequestMeta, fetchBossData, handleBossUnavailable, messageApi, notifyReward, restoreBossClientSequence, sendBossColyseusCommand]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLog([]);
    setBossData(null);
    setBossHp(0);
    setBossMaxHp(0);
    setRespawnRemainingSeconds(0);
    resetRealtimeRepairState();
    sceneSnapshotRef.current = null;
    setSceneSnapshot(null);
    setTurnState(null);
    setBossNextIntent(null);
    setBossUnavailableMessage(null);
    setBattleView(null);
    leavingBossPageRef.current = false;
    lastAutoAdvanceKeyRef.current = "";
    rewardShownRef.current = false;

    void fetchBossData().finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchBossData, resetRealtimeRepairState]);

  // Boss 丹药数量由服务端 inventory_refresh(10302) 帧驱动，落地后即时刷新并回填真实库存。
  const {
    consumables: combatConsumables,
    applyConsumedItem: applyCombatConsumableConsumed,
    lastRefreshedAt: combatInventoryRefreshedAt,
  } = useCombatConsumableInventory({
    inventoryVersion: bossColyseusRoom.stateRefreshVersions.inventory,
    inventorySignal: bossColyseusRoom.stateRefreshSignals.inventory,
  });

  useEffect(() => {
    pageVisibleRef.current = isDocumentVisible();

    const syncVisibility = () => {
      pageVisibleRef.current = isDocumentVisible();
      if (pageVisibleRef.current) {
        void fetchBossData(true);
      }
    };

    const handleVisibilityChange = () => {
      if (!isDocumentVisible()) {
        pageVisibleRef.current = false;
        return;
      }
      syncVisibility();
    };

    window.addEventListener("focus", syncVisibility);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", syncVisibility);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchBossData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!pageVisibleRef.current || leavingBossPageRef.current) {
        return;
      }
      void fetchBossData(true);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [fetchBossData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRespawnRemainingSeconds((current) => {
        if (current <= 0) {
          return 0;
        }
        if (current === 1) {
          if (pageVisibleRef.current) {
            void fetchBossData(true);
          }
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [fetchBossData]);

  useEffect(() => {
    if (!turnState?.turnDeadlineAt) {
      return;
    }

    setTurnNowMs(Date.now());
    const timer = window.setInterval(() => {
      setTurnNowMs(Date.now());
    }, 500);

    return () => window.clearInterval(timer);
  }, [turnState?.turnDeadlineAt]);

  useEffect(() => {
    if (bossHp <= 0 || !turnState?.currentTurnPlayerId || !turnState.turnDeadlineAt) {
      return;
    }

    const deadlineAtMs = Date.parse(turnState.turnDeadlineAt);
    if (!Number.isFinite(deadlineAtMs)) {
      return;
    }

    const advanceKey = `${turnState.currentTurnPlayerId}:${turnState.turnIndex}:${turnState.turnDeadlineAt}`;
    if (lastAutoAdvanceKeyRef.current === advanceKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (lastAutoAdvanceKeyRef.current === advanceKey || turnAdvanceInFlightRef.current) {
        return;
      }
      lastAutoAdvanceKeyRef.current = advanceKey;
      void advanceBossTurn();
    }, Math.max(0, deadlineAtMs - Date.now()) + 40);

    return () => window.clearTimeout(timer);
  }, [advanceBossTurn, bossHp, turnState?.currentTurnPlayerId, turnState?.turnDeadlineAt, turnState?.turnIndex]);

  useEffect(() => {
    if (!logExpanded) {
      return;
    }
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log, logExpanded]);

  useEffect(() => () => {
    timerRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timerRef.current = [];
  }, []);

  useEffect(() => () => {
    void fetch(`/api/game/boss/${monsterId}${bossQuery}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }, [bossQuery, monsterId]);

  const performAction = useCallback(async (payload: Record<string, string>) => {
    if (
      attacking
      || leavingBossPageRef.current
      || bossHp <= 0
      || playerHp <= 0
      || !joined
      || !canAttack
      || (hasSharedTurnState && !isCurrentTurn)
    ) {
      return;
    }

    setAttacking(true);
    try {
      const actionMeta = createBossActionRequestMeta();
      const commandPayload: CombatCommandPayload = payload.action === "item"
        ? {
          commandType: "item",
          itemId: payload.itemId,
        }
        : {
          commandType: "skill",
          ...(payload.skillId ? { skillId: payload.skillId } : {}),
        };
      let responseStatus = 200;
      let json = await sendBossColyseusCommand<BossActionResponse>(commandPayload, actionMeta);
      if (!json) {
        responseStatus = 503;
        json = {
          success: false,
          error: "首领战场暂未连接，请稍候再试",
        };
      }
      restoreBossClientSequence(json.data?.acceptedClientSequence || json.data?.commandResult?.acceptedClientSequence);
      if (handleBossUnavailable(json, responseStatus)) {
        return;
      }
      if (!json.success || !json.data) {
        if (typeof json.respawnRemainingSeconds === "number") {
          setBossHp(0);
          setRespawnRemainingSeconds(Math.max(0, json.respawnRemainingSeconds));
        }
        if (Array.isArray(json.participants)) {
          setParticipants(json.participants);
        }
        if (responseStatus === 403) {
          setJoined(false);
          setRoomFull(true);
          setCanAttack(false);
        }
        messageApi.error(json.error || "首领动作执行失败");
        return;
      }

      const data = json.data;
      const damage = Math.max(0, Number(data.damage || 0));
      const recoveredHp = Math.max(0, Number(data.recoveredHp || 0));
      const recoveredMp = Math.max(0, Number(data.recoveredMp || 0));
      const bossCounterDamage = Math.max(0, Number(data.bossCounterDamage || 0));
      const selectedSkillEffect = payload.action === "skill" && payload.skillId
        ? skillsData[payload.skillId]?.visualEffect || null
        : null;

      applyBossRuntimeUpdate(data);

      if (payload.action === "item" || data.skillOutcome === "heal" || data.skillOutcome === "utility") {
        const recoveryValue = recoveredHp > 0 ? recoveredHp : recoveredMp;
        if (recoveryValue > 0 || payload.action === "skill") {
          triggerMotion({
            actorSide: "player",
            actorSlot: mySlot,
            targetSide: "player",
            targetSlot: mySlot,
            visualEffect: selectedSkillEffect,
          });
        }
        if (recoveryValue > 0) {
          pushPopup({
            targetSide: "player",
            targetSlot: mySlot,
            label: `+${recoveryValue}`,
            kind: "heal",
            delayMs: 120,
          });
        }
      } else {
        triggerMotion({
          actorSide: "player",
          actorSlot: mySlot,
          targetSide: "boss",
          visualEffect: selectedSkillEffect,
        });

        if (damage > 0) {
          pushPopup({
            targetSide: "boss",
            label: `-${damage}`,
            kind: "damage",
            delayMs: 140,
          });
        }
      }

      appendLog(formatActionLog({
        playerName: "你",
        actionType: payload.action === "item" ? "item" : "skill",
        skillName: data.skillName,
        skillOutcome: data.skillOutcome,
        damage,
        recoveredHp,
        recoveredMp,
      }));

      if (payload.action === "item" && payload.itemId) {
        applyCombatConsumableConsumed(payload.itemId);
      }

      applyBossCounterFeedback({
        counterResults: data.bossCounterResults,
        counterSkillName: data.bossCounterSkillName,
        fallbackDamage: 0,
        fallbackTargetPlayerId: playerId,
        fallbackTargetName: "你",
        fallbackTargetSlot: mySlot,
      });

      if (bossCounterDamage > 0 && !data.bossCounterResults?.length) {
        triggerMotion({
          actorSide: "boss",
          targetSide: "player",
          targetSlot: mySlot,
          delayMs: 220,
        });
        pushPopup({
          targetSide: "player",
          targetSlot: mySlot,
          label: `-${bossCounterDamage}`,
          kind: "damage",
          delayMs: 340,
        });

        const counterLog = formatBossCounterLog("你", bossCounterDamage);
        if (counterLog) {
          appendLog(counterLog);
        }
      }

      if (data.died) {
        messageApi.error(data.message || "你不敌世界首领，已被送回复活点。");
        setCanAttack(false);
        setJoined(false);
        window.setTimeout(() => {
          router.push("/game/map");
        }, 900);
        return;
      }

      if (data.bossDead) {
        appendLog("世界首领已被讨伐，正在等待重生。");
        setCanAttack(false);
        setJoined(false);
        notifyReward(data.rewards || []);
      }
    } catch {
      if (!leavingBossPageRef.current) {
        messageApi.error("网络错误，请稍后重试");
      }
    } finally {
      setAttacking(false);
    }
  }, [appendLog, applyBossCounterFeedback, applyBossRuntimeUpdate, applyCombatConsumableConsumed, attacking, bossHp, canAttack, createBossActionRequestMeta, handleBossUnavailable, hasSharedTurnState, isCurrentTurn, joined, messageApi, mySlot, notifyReward, playerHp, playerId, pushPopup, restoreBossClientSequence, router, sendBossColyseusCommand, skillsData, triggerMotion]);

  const handleSkillAction = useCallback((skillId: string) => {
    void performAction({ action: "skill", skillId });
  }, [performAction]);

  const handleItemAction = useCallback((itemId: string) => {
    void performAction({ action: "item", itemId });
  }, [performAction]);

  if (loading) {
    return <BattlePageStateCard mode="loading" />;
  }

  if (!bossData) {
    if (bossUnavailableMessage) {
      return (
        <BattlePageStateCard
          mode="empty"
          title="首领战场不可用"
          description={bossUnavailableMessage}
          primaryActionLabel="返回地图"
          onPrimaryAction={() => leaveBossPage(bossUnavailableMessage)}
        />
      );
    }
    return (
      <BattlePageStateCard
        mode="empty"
        title="首领不存在"
        description="正在尝试退出秘境并返回地图。"
        primaryActionLabel="返回地图"
        onPrimaryAction={() => leaveBossPage("首领不存在，正在尝试退出秘境并返回地图。")}
      />
    );
  }

  return (
    <>
      {contextHolder}
      <UnifiedBattleShell
        pageClassName="boss-page"
        shellClassName="boss-shell"
        topBanner={bossTopBannerBadges.length ? (
          <div className="combat-sync-strip combat-sync-strip--banner">
            {bossTopBannerBadges.map((badge) => <span key={badge} className="combat-sync-chip is-live">{badge}</span>)}
          </div>
        ) : null}
        header={(
          <BattleViewHeaderCard
            battleView={resolvedBattleView}
            extraBadges={[
              joined ? "已入场" : roomFull ? "观战中" : "待补位",
              canAttack ? "可出手" : "等待中",
            ]}
            className="boss-battle-view-card"
          />
        )}
        titleBar={(
          <header className="boss-header">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => leaveBossPage("正在退出战场并返回地图。")}
              className="boss-back-btn"
            />
            <div>
              <div className="boss-header-eyebrow">首领战场</div>
              <div className="boss-header-title">{bossData.name}</div>
            </div>
          </header>
        )}
        topHud={(
          <div className="boss-party-hud">
            {bossHudSlots.map((slot) => slot.isEmpty ? (
              <article key={slot.key} className="boss-compact-card boss-compact-card--empty">
                <div className="boss-compact-card-head">
                  <div className="boss-compact-card-title-wrap">
                    <span className="boss-compact-card-slot">{slot.slotTitle}</span>
                    <span className="boss-compact-card-name">{slot.name}</span>
                  </div>
                </div>
                <div className="boss-compact-card-empty">预留组队席位</div>
              </article>
            ) : (
              <BossCompactStatusCard
                key={slot.key}
                slotTitle={slot.slotTitle}
                name={slot.name}
                badge={slot.badge}
                hp={slot.hp}
                maxHp={slot.maxHp}
                mp={slot.mp}
                maxMp={slot.maxMp}
                className={slot.className}
              />
            ))}
          </div>
        )}
        topHudClassName="boss-top-hud"
        primaryClassName="boss-main"
        primaryContent={(
          <section className="boss-card boss-stage-card">
            <div className="boss-stage-head">
              <div className="boss-stage-head-main">
                <div className="boss-stage-copy">
                  <div className="boss-card-title">战场态势</div>
                  <div className="boss-card-copy">{bossData.description || "灵场已开启，保持在线即可自动入场对敌。"}</div>
                </div>
                <div className="boss-stage-head-pills">
                  <span className="boss-stage-head-chip">{stageStatusText}</span>
                  {sharedTurnText ? <span className="boss-stage-head-chip">{sharedTurnText}</span> : null}
                  <span className={`boss-stage-head-chip ${joined ? "is-ready" : roomFull ? "is-watch" : "is-wait"}`}>
                    {seatStatusText}
                  </span>
                </div>
              </div>
              <div className="boss-room-summary">{roomSummary}</div>
              {isWaitingState ? (
                <div className="boss-wait-strip">
                  <span>{respawnRemainingSeconds > 0 ? `预计 ${respawnRemainingSeconds}s 后重生` : "世界首领即将回归战场"}</span>
                  <span>{activeParticipants.length}/3 在场</span>
                </div>
              ) : (
                <BossTurnPanel
                  currentTurnText={turnOwnerText}
                  countdownText={turnCountdownText}
                  intentText={bossIntentSummaryText}
                  badgeText={turnPanelBadgeText}
                  isActive={Boolean(hasSharedTurnState && isCurrentTurn && canAttack)}
                />
              )}
            </div>

            <div className="boss-scene">
              <BattleStageBackdropCanvas
                mode="boss"
                clashActive={Boolean(activeMotion)}
                units={backdropUnits}
                sceneSnapshot={sceneSnapshot}
              />

              <BattleStageEntityCanvas
                mode="boss"
                units={stageUnits}
                motion={stageMotion}
                sceneSnapshot={sceneSnapshot}
              />

              <div className="boss-stage-overlay">
                {popups.map((popup) => {
                  const targetId = popup.targetSide === "boss"
                    ? bossEntityId
                    : activeParticipants.find((participant) => participant.slot === popup.targetSlot)?.playerId;
                  if (!targetId) {
                    return null;
                  }
                  const anchor = getBattleSceneFeedbackAnchor({
                    anchor: stageAnchorMap.get(targetId) || null,
                    role: popup.targetSide,
                    kind: "popup",
                  });
                  if (!anchor) {
                    return null;
                  }
                  return (
                    <div
                      key={popup.id}
                      className="boss-stage-popup-anchor"
                      style={{ left: `${anchor.xPercent}%`, top: `${anchor.yPercent}%` }}
                    >
                      <span className={`boss-popup boss-popup--${popup.kind}`}>{popup.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="boss-roster-grid boss-roster-grid--stage">
              {rosterSlots.map((participant, slotIndex) => participant ? (
                <article
                  key={participant.playerId}
                  className={`boss-roster-card ${participant.playerId === playerId ? "is-current" : ""}`}
                >
                  <div className="boss-roster-card-head">
                    <span className="boss-roster-seat">{slotIndex + 1} 号位</span>
                    <span className={`boss-status-pill ${participant.hp <= 0 ? "is-wait" : participant.playerId === highlightedParticipantId ? "is-active" : participant.playerId === playerId ? "is-ready" : ""}`}>
                      {participant.hp <= 0 ? "已倒下" : participant.playerId === highlightedParticipantId ? "当前回合" : participant.playerId === playerId ? "你" : "待命"}
                    </span>
                  </div>
                  <div className="boss-roster-card-main">
                    <PlayerAvatar
                      avatarImageUrl={participant.avatarImageUrl}
                      avatarFrameImageUrl={participant.avatarFrameImageUrl}
                      size={42}
                      fallbackText={getFallbackText(participant.playerName)}
                      fallbackFontSize={14}
                      fallbackFontWeight={700}
                      background="radial-gradient(circle at 32% 28%, rgba(255,255,255,0.18), rgba(16,24,33,0.94))"
                      borderColor="rgba(214, 225, 242, 0.28)"
                    />
                    <div className="boss-roster-copy">
                      <div className="boss-roster-name">{participant.playerName}</div>
                      <div className="boss-roster-meta">
                        {participant.playerId === playerId ? "你的固定席位" : "组队席位"}
                      </div>
                    </div>
                  </div>
                  <div className="boss-roster-meters">
                    <div className="boss-meter is-compact">
                      <div className="boss-meter-track">
                        <div className="boss-meter-fill boss-meter-fill--hp" style={{ width: `${clampPercent(participant.hp, participant.maxHp)}%` }} />
                      </div>
                      <div className="boss-meter-value">{participant.hp}/{participant.maxHp}</div>
                    </div>
                    <div className="boss-meter is-compact">
                      <div className="boss-meter-track">
                        <div className="boss-meter-fill boss-meter-fill--mp" style={{ width: `${clampPercent(participant.mp, participant.maxMp)}%` }} />
                      </div>
                      <div className="boss-meter-value">{participant.mp}/{participant.maxMp}</div>
                    </div>
                  </div>
                </article>
              ) : (
                <article key={`empty-slot-${slotIndex}`} className="boss-roster-card boss-roster-card--empty boss-roster-card--empty-stage">
                  <div className="boss-roster-empty-title">预留席位</div>
                  <div className="boss-roster-empty-copy">组队道友或中途加入者会自动补到这里</div>
                </article>
              ))}
            </div>
          </section>
        )}
        sideRailClassName="boss-side-rail"
        sideRailContent={(
          <>
            <section className="boss-card boss-log-card">
              <button
                type="button"
                className="boss-log-toggle"
                onClick={() => setLogExpanded((current) => !current)}
                aria-expanded={logExpanded}
              >
                <span>
                  <span className="boss-log-title">战报</span>
                  <span className="boss-log-summary">{logSummary}</span>
                </span>
                <span className="boss-log-icon">
                  {logExpanded ? <UpOutlined /> : <DownOutlined />}
                </span>
              </button>

              {logExpanded ? (
                <div ref={logRef} className="boss-log-list">
                  {log.length ? log.map((entry, index) => (
                    <div key={`${entry}-${index}`} className="boss-log-item">
                      <span className="boss-log-index">#{index + 1}</span>
                      <span className="boss-log-entry">{entry}</span>
                    </div>
                  )) : (
                    <div className="boss-log-empty">{bossData.description || "首领战场已开启。"}</div>
                  )}
                </div>
              ) : null}
            </section>
            {renderBossActionPanel("combat-action-panel boss-combat-action-panel")}
          </>
        )}
        mobileDock={renderBossActionPanel("combat-action-panel combat-action-panel--mobile boss-combat-action-panel boss-combat-action-panel--mobile")}
        mobileDockClassName="boss-mobile-dock"
      />
    </>
  );
}
