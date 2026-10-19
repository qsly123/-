"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { message } from "antd";
import {
  ArrowLeftOutlined,
  CloseCircleOutlined,
  DownOutlined,
  FireOutlined,
  HeartOutlined,
  MedicineBoxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useRouter, useSearchParams } from "next/navigation";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import RewardDropList from "@/modules/shared/ui/components/RewardDropList";
import type {
  CombatLogEntry,
  CombatRepeatGuardPayload,
  CombatState,
  CombatUnit,
  SkillEffect,
  SkillSourceType,
} from "@/types/game";

type SkillView = {
  name: string;
  skillType: string;
  sourceType?: SkillSourceType;
  damageBase: number;
  damageMultiplier: number;
  mpCost: number;
  cooldown: number;
  effects: SkillEffect[];
  target: string;
};

type SceneSnapshotLite = {
  tick?: number;
  sequence?: number;
};

type StartApiResponse = {
  success?: boolean;
  error?: string;
  data?: {
    combatId: string;
    partyCombatId?: string;
    state: CombatState;
    skillsData: Record<string, SkillView>;
    skillRotation?: string[];
    sceneSnapshot?: SceneSnapshotLite | null;
  };
};

type ActionApiResponse = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  data?: {
    state?: CombatState | null;
    acceptedClientSequence?: number;
    serverSceneTick?: number;
    sceneSnapshot?: SceneSnapshotLite | null;
    itemId?: string;
  };
};

type DropView = {
  itemId: string;
  itemName: string;
  itemIconUrl?: string | null;
  quantity: number;
  itemRarity?: string | null;
};

type SettleApiResponse = {
  success?: boolean;
  error?: string;
  data?: {
    xp?: number;
    gold?: number;
    drops?: DropView[];
    noRewardReason?: string;
    antiRepeatGuard?: CombatRepeatGuardPayload;
    died?: boolean;
    fled?: boolean;
    message?: string;
  };
};

type CombatConsumable = {
  itemId: string;
  name: string;
  iconUrl?: string | null;
  quantity: number;
  effects: Array<{ type?: string; value?: number; text?: string }>;
};

type InventoryApiResponse = {
  success?: boolean;
  data?: {
    items?: Array<{
      itemId?: string;
      name?: string;
      iconUrl?: string | null;
      quantity?: number;
      itemType?: string;
      effects?: Array<{ type?: string; value?: number; text?: string }>;
    }>;
  };
};

type CombatActionKind = "skill" | "item" | "flee" | "surrender";

const AUTO_TURN_DELAY_MS = 760;

function decodeCombatRouteMonsterId(value: string) {
  if (!value.includes("%")) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function clampPercent(current: number, max: number) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function getUnitInitial(unit: CombatUnit) {
  const compactName = unit.name.replace(/\s+/g, "");
  return compactName ? compactName.slice(0, 2) : unit.isPlayer ? "修士" : "妖兽";
}

function getStatusText(state: CombatState, isPartyCombat: boolean, isMyTurn: boolean) {
  if (state.status === "player_win") {
    return "胜利";
  }
  if (state.status === "enemy_win") {
    return "战败";
  }
  if (state.status === "fled") {
    return "已撤离";
  }
  if (isPartyCombat) {
    return isMyTurn ? "轮到你出手" : "等待队友";
  }
  return "你的回合";
}

function hasCombatRecoveryEffect(item: CombatConsumable) {
  return item.effects.some((effect) => (
    (effect.type === "heal_hp" || effect.type === "heal_mp")
    && Number(effect.value || 0) > 0
  ));
}

function getSkillTone(skill: SkillView) {
  if (skill.skillType === "heal" || skill.target === "self") {
    return "is-support";
  }
  if (skill.sourceType === "artifact") {
    return "is-artifact";
  }
  return "is-attack";
}

function readErrorText(response: Response, json: { error?: string } | null, fallback: string) {
  if (response.ok) {
    return json?.error || fallback;
  }
  return json?.error || fallback;
}

function UnitPlate({ unit, side }: { unit: CombatUnit; side: "enemy" | "player" }) {
  const hpPercent = clampPercent(unit.hp, unit.maxHp);
  const mpPercent = clampPercent(unit.mp, unit.maxMp);

  return (
    <section className={`turn-combat-unit is-${side} ${unit.hp <= 0 ? "is-defeated" : ""}`}>
      <div className="turn-combat-unit__avatar">
        {unit.avatarImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={unit.avatarImageUrl} alt={unit.name} />
        ) : (
          <span>{getUnitInitial(unit)}</span>
        )}
      </div>
      <div className="turn-combat-unit__body">
        <div className="turn-combat-unit__meta">
          <strong>{unit.name}</strong>
          <span>{typeof unit.realm === "number" ? `境界 ${unit.realm}` : side === "enemy" ? "目标" : "本体"}</span>
        </div>
        <div className="turn-combat-bars">
          <div className="turn-combat-bar is-hp">
            <span style={{ width: `${hpPercent}%` }} />
            <b>气血 {Math.max(0, Math.floor(unit.hp))}/{Math.max(0, Math.floor(unit.maxHp))}</b>
          </div>
          <div className="turn-combat-bar is-mp">
            <span style={{ width: `${mpPercent}%` }} />
            <b>灵力 {Math.max(0, Math.floor(unit.mp))}/{Math.max(0, Math.floor(unit.maxMp))}</b>
          </div>
        </div>
      </div>
    </section>
  );
}

function LogEntryView({ entry }: { entry: CombatLogEntry }) {
  const tone = entry.actorId && entry.targetId
    ? entry.damage
      ? "is-damage"
      : entry.heal
        ? "is-heal"
        : "is-action"
    : "is-system";

  return (
    <li className={`turn-combat-log-entry ${tone}`}>
      <span>第 {entry.turn} 回合</span>
      <p>{entry.message}</p>
    </li>
  );
}

export default function TurnBasedCombatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const monsterId = decodeCombatRouteMonsterId(id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const routePartyCombatId = searchParams.get("partyCombatId")?.trim() || "";
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [combatId, setCombatId] = useState("");
  const [partyCombatId, setPartyCombatId] = useState("");
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [skillsData, setSkillsData] = useState<Record<string, SkillView>>({});
  const [skillRotation, setSkillRotation] = useState<string[]>([]);
  const [combatConsumables, setCombatConsumables] = useState<CombatConsumable[]>([]);
  const [acting, setActing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [rotationCursor, setRotationCursor] = useState(0);
  const [logExpanded, setLogExpanded] = useState(false);
  const [settleResult, setSettleResult] = useState<SettleApiResponse["data"] | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const acceptedSequenceRef = useRef(0);
  const sceneTickRef = useRef(0);
  const settledCombatKeyRef = useRef("");
  const latestStateRef = useRef<CombatState | null>(null);

  useEffect(() => {
    latestStateRef.current = combatState;
  }, [combatState]);

  const exitCombatScene = useCallback(() => {
    router.push("/game/map");
  }, [router]);

  const applyActionSync = useCallback((payload?: ActionApiResponse["data"] | StartApiResponse["data"]) => {
    if (!payload) {
      return;
    }
    if ("state" in payload && payload.state) {
      setCombatState(payload.state);
    }
    const acceptedClientSequence = "acceptedClientSequence" in payload
      ? payload.acceptedClientSequence
      : undefined;
    if (typeof acceptedClientSequence === "number") {
      acceptedSequenceRef.current = Math.max(acceptedSequenceRef.current, acceptedClientSequence);
    }
    const nextTick = ("serverSceneTick" in payload && typeof payload.serverSceneTick === "number")
      ? payload.serverSceneTick
      : payload.sceneSnapshot?.tick;
    if (typeof nextTick === "number") {
      sceneTickRef.current = nextTick;
    }
  }, []);

  const loadConsumables = useCallback(async () => {
    try {
      const response = await fetch("/api/game/inventory", { cache: "no-store" });
      const json = await response.json().catch(() => null) as InventoryApiResponse | null;
      if (!response.ok || !json?.success) {
        return;
      }
      const items = (json.data?.items || [])
        .map((item) => ({
          itemId: item.itemId || "",
          name: item.name || item.itemId || "丹药",
          iconUrl: item.iconUrl || null,
          quantity: Number(item.quantity || 0),
          effects: item.effects || [],
          itemType: item.itemType || "",
        }))
        .filter((item) => (
          item.itemId
          && item.quantity > 0
          && item.itemType === "consumable"
          && hasCombatRecoveryEffect(item)
        ));
      setCombatConsumables(items);
    } catch {
      setCombatConsumables([]);
    }
  }, []);

  const startCombat = useCallback(async () => {
    setLoading(true);
    setStartupError(null);
    setSettleResult(null);
    setSettleError(null);
    setAutoEnabled(false);
    setRotationCursor(0);
    settledCombatKeyRef.current = "";
    acceptedSequenceRef.current = 0;
    sceneTickRef.current = 0;

    try {
      const response = await fetch("/api/game/combat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monsterId,
          partyCombatId: routePartyCombatId || undefined,
        }),
      });
      const json = await response.json().catch(() => null) as StartApiResponse | null;
      if (!response.ok || !json?.success || !json.data?.state) {
        throw new Error(readErrorText(response, json || null, "战斗建立失败"));
      }
      setCombatId(json.data.combatId);
      setPartyCombatId(json.data.partyCombatId || "");
      setCombatState(json.data.state);
      setSkillsData(json.data.skillsData || {});
      setSkillRotation(json.data.skillRotation?.length ? json.data.skillRotation : json.data.state.player.skills);
      applyActionSync(json.data);
      void loadConsumables();
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : "战斗建立失败");
      setCombatState(null);
    } finally {
      setLoading(false);
    }
  }, [applyActionSync, loadConsumables, monsterId, routePartyCombatId]);

  useEffect(() => {
    void startCombat();
  }, [startCombat]);

  const submitAction = useCallback(async (params: {
    action: CombatActionKind;
    skillId?: string;
    itemId?: string;
    fromAuto?: boolean;
  }) => {
    const current = latestStateRef.current;
    if (!current || current.status !== "ongoing" || acting || settling) {
      return;
    }

    setActing(true);
    const clientSequence = acceptedSequenceRef.current + 1;
    try {
      const response = await fetch("/api/game/combat/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          combatId: partyCombatId ? undefined : combatId,
          partyCombatId: partyCombatId || undefined,
          action: params.action,
          skillId: params.skillId,
          itemId: params.itemId,
          clientSequence,
          clientSceneTick: sceneTickRef.current,
          actionId: `${partyCombatId || combatId}:${clientSequence}:${Date.now()}`,
          clientSentAt: Date.now(),
        }),
      });
      const json = await response.json().catch(() => null) as ActionApiResponse | null;
      applyActionSync(json?.data);
      if (!response.ok || !json?.success) {
        if (!params.fromAuto) {
          messageApi.warning(json?.error || "本回合出手失败，请按最新战局重试");
        }
        return;
      }
      if (params.itemId && json.data?.itemId) {
        setCombatConsumables((items) => items
          .map((item) => item.itemId === params.itemId ? { ...item, quantity: item.quantity - 1 } : item)
          .filter((item) => item.quantity > 0));
      }
      if (json.data?.state?.status && json.data.state.status !== "ongoing") {
        setAutoEnabled(false);
      }
    } catch {
      if (!params.fromAuto) {
        messageApi.error("战斗执行失败");
      }
    } finally {
      setActing(false);
    }
  }, [acting, applyActionSync, combatId, messageApi, partyCombatId, settling]);

  const settleCombat = useCallback(async (state: CombatState) => {
    const key = `${partyCombatId || combatId}:${state.status}`;
    if (!combatId || state.status === "ongoing" || settledCombatKeyRef.current === key) {
      return;
    }
    settledCombatKeyRef.current = key;
    setSettling(true);
    setSettleError(null);
    try {
      const response = await fetch("/api/game/combat/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          combatId: partyCombatId ? undefined : combatId,
          partyCombatId: partyCombatId || undefined,
        }),
      });
      const json = await response.json().catch(() => null) as SettleApiResponse | null;
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "战斗结算失败");
      }
      setSettleResult(json.data || {});
    } catch (error) {
      settledCombatKeyRef.current = "";
      setSettleError(error instanceof Error ? error.message : "战斗结算失败");
    } finally {
      setSettling(false);
    }
  }, [combatId, partyCombatId]);

  useEffect(() => {
    if (combatState?.status && combatState.status !== "ongoing") {
      void settleCombat(combatState);
    }
  }, [combatState, settleCombat]);

  const isPartyCombat = combatState?.mode === "party" || Boolean(partyCombatId);
  const isMyTurn = !isPartyCombat || combatState?.currentTurnPlayerId === combatState?.player.id;
  const playerSkills = useMemo(() => {
    if (!combatState) {
      return [];
    }
    return combatState.player.skills
      .map((skillId) => {
        const skill = skillsData[skillId];
        return skill ? { id: skillId, ...skill } : null;
      })
      .filter((skill): skill is { id: string } & SkillView => Boolean(skill));
  }, [combatState, skillsData]);
  const orderedSkills = useMemo(() => {
    const byId = new Map(playerSkills.map((skill) => [skill.id, skill]));
    const ordered = skillRotation.map((skillId) => byId.get(skillId)).filter((skill): skill is { id: string } & SkillView => Boolean(skill));
    for (const skill of playerSkills) {
      if (!ordered.some((entry) => entry.id === skill.id)) {
        ordered.push(skill);
      }
    }
    return ordered;
  }, [playerSkills, skillRotation]);
  const latestLog = combatState?.log[combatState.log.length - 1]?.message || "战斗尚未开始";
  const visibleLogs = logExpanded ? combatState?.log || [] : (combatState?.log || []).slice(-4);
  const statusText = combatState ? getStatusText(combatState, isPartyCombat, Boolean(isMyTurn)) : "准备中";
  const canAct = Boolean(combatState && combatState.status === "ongoing" && isMyTurn && !acting && !settling);

  const pickAutoSkill = useCallback(() => {
    const current = latestStateRef.current;
    if (!current) {
      return null;
    }
    const available = orderedSkills.filter((skill) => (
      Number(current.player.skillCooldowns?.[skill.id] || 0) <= 0
      && current.player.mp >= Number(skill.mpCost || 0)
    ));
    if (!available.length) {
      return null;
    }
    const preferredIds = skillRotation.length ? skillRotation : available.map((skill) => skill.id);
    for (let offset = 0; offset < preferredIds.length; offset += 1) {
      const skillId = preferredIds[(rotationCursor + offset) % preferredIds.length];
      const skill = available.find((entry) => entry.id === skillId);
      if (skill) {
        return skill;
      }
    }
    return available[0];
  }, [orderedSkills, rotationCursor, skillRotation]);

  useEffect(() => {
    if (!autoEnabled || !combatState || combatState.status !== "ongoing" || !canAct) {
      return;
    }
    const timer = window.setTimeout(() => {
      const skill = pickAutoSkill();
      if (!skill) {
        setAutoEnabled(false);
        messageApi.warning("当前没有可自动释放的神通");
        return;
      }
      const index = skillRotation.indexOf(skill.id);
      if (index >= 0 && skillRotation.length > 0) {
        setRotationCursor((index + 1) % skillRotation.length);
      }
      void submitAction({ action: "skill", skillId: skill.id, fromAuto: true });
    }, AUTO_TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoEnabled, canAct, combatState, messageApi, pickAutoSkill, skillRotation, submitAction]);

  if (loading) {
    return (
      <main className="turn-combat-root">
        {contextHolder}
        <div className="turn-combat-state">
          <ReloadOutlined spin />
          <strong>正在布置战场</strong>
        </div>
      </main>
    );
  }

  if (!combatState) {
    return (
      <main className="turn-combat-root">
        {contextHolder}
        <div className="turn-combat-state">
          <CloseCircleOutlined />
          <strong>战斗尚未建立</strong>
          <p>{startupError || "当前无法进入战斗，请重新尝试。"}</p>
          <div className="turn-combat-state__actions">
            <button type="button" onClick={() => void startCombat()}>
              <ReloadOutlined />
              重试
            </button>
            <button type="button" onClick={exitCombatScene}>
              <ArrowLeftOutlined />
              返回地图
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="turn-combat-root">
      {contextHolder}
      <div className="turn-combat-shell">
        <header className="turn-combat-topbar">
          <button type="button" className="turn-combat-icon-button" onClick={exitCombatScene} aria-label="返回地图">
            <ArrowLeftOutlined />
          </button>
          <div>
            <span>{isPartyCombat ? "组队回合" : "站桩回合"}</span>
            <strong>{statusText}</strong>
          </div>
          <button
            type="button"
            className={`turn-combat-auto ${autoEnabled ? "is-on" : ""}`}
            disabled={!skillRotation.length || combatState.status !== "ongoing" || settling}
            onClick={() => {
              if (autoEnabled) {
                setAutoEnabled(false);
                return;
              }
              setRotationCursor(0);
              setAutoEnabled(true);
            }}
          >
            {autoEnabled ? <StopOutlined /> : <PlayCircleOutlined />}
            <span>{autoEnabled ? "停止" : "自动"}</span>
          </button>
        </header>

        <section className="turn-combat-stage">
          <UnitPlate unit={combatState.enemy} side="enemy" />
          <div className="turn-combat-duel-line">
            <i />
            <span>第 {combatState.turn} 回合</span>
            <i />
          </div>
          <UnitPlate unit={combatState.player} side="player" />
        </section>

        <section className="turn-combat-summary">
          <FireOutlined />
          <p>{latestLog}</p>
        </section>

        {settleResult || settleError || settling ? (
          <section className="turn-combat-settle">
            <strong>{combatState.status === "player_win" ? "战斗胜利" : combatState.status === "fled" ? "已脱离战斗" : "战斗结束"}</strong>
            {settling ? <p>正在结算...</p> : null}
            {settleError ? <p>{settleError}</p> : null}
            {settleResult ? (
              <>
                {settleResult.message ? <p>{settleResult.message}</p> : null}
                <div className="turn-combat-reward-row">
                  <span>修为 +{settleResult.xp || 0}</span>
                  <span>灵石 +{settleResult.gold || 0}</span>
                </div>
                {settleResult.drops?.length ? (
                  <RewardDropList drops={settleResult.drops} iconSize={18} />
                ) : null}
              </>
            ) : null}
            <div className="turn-combat-settle__actions">
              {settleError ? (
                <button type="button" onClick={() => void settleCombat(combatState)}>
                  <ReloadOutlined />
                  重试结算
                </button>
              ) : null}
              <button type="button" onClick={exitCombatScene}>
                <ArrowLeftOutlined />
                返回地图
              </button>
            </div>
          </section>
        ) : null}

        <section className="turn-combat-actions" aria-label="战斗操作">
          <div className="turn-combat-action-head">
            <strong>{autoEnabled ? "自动回合中" : canAct ? "选择本回合动作" : "等待战局"}</strong>
            <span>{acting ? "出手中" : settling ? "结算中" : canAct ? "出手后将迎来反击" : statusText}</span>
          </div>

          <div className="turn-combat-skill-grid">
            {orderedSkills.map((skill) => {
              const cooldownLeft = Number(combatState.player.skillCooldowns?.[skill.id] || 0);
              const mpCost = Number(skill.mpCost || 0);
              const disabled = !canAct || autoEnabled || cooldownLeft > 0 || combatState.player.mp < mpCost;
              return (
                <button
                  type="button"
                  key={skill.id}
                  className={`turn-combat-skill ${getSkillTone(skill)}`}
                  disabled={disabled}
                  onClick={() => void submitAction({ action: "skill", skillId: skill.id })}
                >
                  <ThunderboltOutlined />
                  <span>{skill.name}</span>
                  <b>{cooldownLeft > 0 ? `冷却 ${cooldownLeft}` : `MP ${mpCost}`}</b>
                </button>
              );
            })}
          </div>

          {combatConsumables.length ? (
            <div className="turn-combat-items">
              {combatConsumables.map((item) => (
                <button
                  type="button"
                  key={item.itemId}
                  disabled={!canAct || autoEnabled}
                  onClick={() => void submitAction({ action: "item", itemId: item.itemId })}
                >
                  <ItemIcon iconUrl={item.iconUrl} size={18} />
                  <span>{item.name}</span>
                  <b>x{item.quantity}</b>
                </button>
              ))}
            </div>
          ) : null}

          <div className="turn-combat-command-row">
            <button
              type="button"
              disabled={combatState.status !== "ongoing" || acting || settling || autoEnabled}
              onClick={() => void submitAction({ action: "flee" })}
            >
              <ArrowLeftOutlined />
              撤离
            </button>
            {!isPartyCombat ? (
              <button
                type="button"
                className="is-danger"
                disabled={combatState.status !== "ongoing" || acting || settling || autoEnabled}
                onClick={() => void submitAction({ action: "surrender" })}
              >
                <CloseCircleOutlined />
                认输
              </button>
            ) : null}
          </div>
        </section>

        <section className={`turn-combat-log ${logExpanded ? "is-expanded" : "is-collapsed"}`}>
          <button type="button" className="turn-combat-log__toggle" onClick={() => setLogExpanded((value) => !value)}>
            <span>战报</span>
            <b>{combatState.log.length} 条</b>
            <DownOutlined className={logExpanded ? "is-open" : ""} />
          </button>
          <ol>
            {visibleLogs.map((entry, index) => (
              <LogEntryView key={`${entry.turn}-${index}-${entry.message}`} entry={entry} />
            ))}
          </ol>
        </section>

        <footer className="turn-combat-footer">
          <span><HeartOutlined /> 气血与伤势随回合变化</span>
          <span><MedicineBoxOutlined /> 丹药会消耗背包数量</span>
        </footer>
      </div>
    </main>
  );
}
