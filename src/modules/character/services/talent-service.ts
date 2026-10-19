/**
 * 修炼流派（天赋）服务。
 *
 * 设计要点（见 `docs/current/talent-paths-design.md` 与 `benchmark-gbsh-ynxy.md`）：
 *
 * 1. **三层抉择**：筑基（major 2）选道途 → 结丹（major 3）选流派 → 元婴（major 4）选道心。
 *    每层各一次，后一层挂在前一层之下（道心 parentKey = 已选流派）。
 *    依据：一念逍遥开局实际只有两条主修，四条路线是后期铺开的；
 *    道心是补上去的第三层 —— 原先结丹选完就再无抉择，元婴到满级都是一条直线。
 * 2. **强弱随阶段轮换**：流派加成不是恒定值，而是按大境界分段的曲线。
 *    依据：玩家经验是「返虚前体修强、返虚后法修反超」。
 *    实现：体修前期给的百分比高、后期走低；剑修前期平淡、中后期抬升。
 *    由于后期基础数值本身更大，百分比下降仍可保持绝对收益，形成相对强势期的轮换。
 * 3. **数值护栏**：只输出 percent 层，不写回基础属性；单派总量控制在 ±15% 以内。
 * 4. **符修不给神识**：治疗公式 `+2.15 × 神识`（`HEAL_SPIRITUAL_SENSE_RATIO`）会让堆神识的
 *    符修意外变成最强治疗，与「洞察 / 控场」定位错位，故符修改走法力上限与法宝增伤。
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { playerTalents, players, talentPaths } from "@/db/schema";
import type { StatPercentBonus } from "@/modules/character/services/framework/stat-modifiers";

export const TALENT_KIND_DIRECTION = "direction";
export const TALENT_KIND_PATH = "path";
/** 元婴（major 4）抉择：道心。挂在已选流派之下，是三层里的最后一层。 */
export const TALENT_KIND_DAOXIN = "daoxin";

export interface TalentStageCurveEntry {
  fromMajor: number;
  percent: Record<string, number>;
}

export interface TalentPathRow {
  key: string;
  name: string;
  kind: string;
  parentKey: string | null;
  description: string | null;
  unlockMajor: number;
  stageCurve: TalentStageCurveEntry[];
}

/** 取 `fromMajor <= major` 的最大一段，即当前阶段生效的加成。 */
export function resolveStagePercent(
  curve: TalentStageCurveEntry[] | null | undefined,
  major: number,
): StatPercentBonus {
  if (!curve || curve.length === 0) {
    return {};
  }
  const sorted = [...curve].sort((a, b) => a.fromMajor - b.fromMajor);
  let picked: TalentStageCurveEntry | null = null;
  for (const entry of sorted) {
    if (Number(entry.fromMajor) <= major) {
      picked = entry;
    }
  }
  if (!picked) {
    return {};
  }
  const result: StatPercentBonus = {};
  for (const [key, value] of Object.entries(picked.percent || {})) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      (result as Record<string, number>)[key] = numeric;
    }
  }
  return result;
}

export async function getPlayerRealmMajor(playerId: string): Promise<number> {
  const row = await db
    .select({ realmMajor: players.realmMajor })
    .from(players)
    .where(eq(players.id, playerId))
    .get();
  return Math.max(1, Number(row?.realmMajor || 1));
}

export async function getPlayerTalentKeys(playerId: string): Promise<string[]> {
  const rows = await db
    .select({ pathKey: playerTalents.pathKey })
    .from(playerTalents)
    .where(eq(playerTalents.playerId, playerId))
    .all();
  return rows.map((row) => row.pathKey);
}

/** 玩家当前可选的抉择：境界达标、且该抉择点尚未选择。 */
export async function getAvailableTalentOptions(playerId: string): Promise<TalentPathRow[]> {
  const major = await getPlayerRealmMajor(playerId);
  const chosen = new Set(await getPlayerTalentKeys(playerId));

  const rows = await db
    .select({
      key: talentPaths.key,
      name: talentPaths.name,
      kind: talentPaths.kind,
      parentKey: talentPaths.parentKey,
      description: talentPaths.description,
      unlockMajor: talentPaths.unlockMajor,
      stageCurve: talentPaths.stageCurve,
    })
    .from(talentPaths)
    .where(eq(talentPaths.enabled, true))
    .orderBy(asc(talentPaths.unlockMajor), asc(talentPaths.key))
    .all();

  const chosenRows = chosen.size > 0
    ? await db
      .select({ key: talentPaths.key, kind: talentPaths.kind })
      .from(talentPaths)
      .where(eq(talentPaths.enabled, true))
      .all()
    : [];

  const chosenKinds = new Set(
    chosenRows.filter((row) => chosen.has(row.key)).map((row) => row.kind),
  );
  const chosenDirectionKey = chosenRows.find(
    (row) => chosen.has(row.key) && row.kind === TALENT_KIND_DIRECTION,
  )?.key || null;
  const chosenPathKey = chosenRows.find(
    (row) => chosen.has(row.key) && row.kind === TALENT_KIND_PATH,
  )?.key || null;

  return rows
    .filter((row) => Number(row.unlockMajor) <= major)
    .filter((row) => !chosenKinds.has(row.kind))
    // 流派挂在已选方向之下，道心挂在已选流派之下
    .filter((row) => {
      if (row.kind === TALENT_KIND_PATH) {
        return !row.parentKey || row.parentKey === chosenDirectionKey;
      }
      if (row.kind === TALENT_KIND_DAOXIN) {
        return !row.parentKey || row.parentKey === chosenPathKey;
      }
      return true;
    })
    .map((row) => ({
      key: row.key,
      name: row.name,
      kind: row.kind,
      parentKey: row.parentKey,
      description: row.description,
      unlockMajor: Number(row.unlockMajor),
      stageCurve: (row.stageCurve || []) as TalentStageCurveEntry[],
    }));
}

/** 汇总玩家所有已选流派在当前境界的百分比加成。 */
export async function getPlayerTalentPercent(playerId: string): Promise<StatPercentBonus> {
  const major = await getPlayerRealmMajor(playerId);
  const rows = await db
    .select({
      stageCurve: talentPaths.stageCurve,
      enabled: talentPaths.enabled,
    })
    .from(talentPaths)
    .innerJoin(playerTalents, eq(playerTalents.pathKey, talentPaths.key))
    .where(and(
      eq(playerTalents.playerId, playerId),
      eq(talentPaths.enabled, true),
    ))
    .all();

  const merged: StatPercentBonus = {};
  for (const row of rows) {
    const percent = resolveStagePercent(row.stageCurve as TalentStageCurveEntry[], major);
    for (const [key, value] of Object.entries(percent)) {
      (merged as Record<string, number>)[key] =
        ((merged as Record<string, number>)[key] || 0) + value;
    }
  }
  return merged;
}

export interface TalentOverviewNode {
  key: string;
  name: string;
  kind: string;
  parentKey: string | null;
  description: string | null;
  unlockMajor: number;
  /** 当前境界下这一节点实际生效的加成 */
  currentPercent: StatPercentBonus;
  chosenAtMajor: number;
}

export interface TalentOverview {
  major: number;
  nodes: TalentOverviewNode[];
  totalPercent: StatPercentBonus;
  /** 三层各自的解锁境界，供前端显示"未到境界" */
  layerUnlock: Record<string, number>;
}

/**
 * 玩家已选天赋总览，用于常驻展示。
 *
 * 原先玩家只能在抉择弹窗里看到天赋，选完就再也找不到了 —— 这是"感受不到天赋存在"的
 * 一半原因。这里把三层（道途/流派/道心）按顺序列出来，连同当前境界实际生效的加成。
 */
export async function getPlayerTalentOverview(playerId: string): Promise<TalentOverview> {
  const major = await getPlayerRealmMajor(playerId);

  const rows = await db
    .select({
      key: talentPaths.key,
      name: talentPaths.name,
      kind: talentPaths.kind,
      parentKey: talentPaths.parentKey,
      description: talentPaths.description,
      unlockMajor: talentPaths.unlockMajor,
      stageCurve: talentPaths.stageCurve,
      chosenAtMajor: playerTalents.chosenAtMajor,
    })
    .from(playerTalents)
    .innerJoin(talentPaths, eq(talentPaths.key, playerTalents.pathKey))
    .where(eq(playerTalents.playerId, playerId))
    .all();

  const layerOrder: Record<string, number> = {
    [TALENT_KIND_DIRECTION]: 0,
    [TALENT_KIND_PATH]: 1,
    [TALENT_KIND_DAOXIN]: 2,
  };

  const nodes = rows
    .map((row) => ({
      key: row.key,
      name: row.name,
      kind: row.kind,
      parentKey: row.parentKey,
      description: row.description,
      unlockMajor: Number(row.unlockMajor),
      currentPercent: resolveStagePercent(row.stageCurve, major),
      chosenAtMajor: Number(row.chosenAtMajor),
    }))
    .sort((a, b) => (layerOrder[a.kind] ?? 9) - (layerOrder[b.kind] ?? 9));

  return {
    major,
    nodes,
    totalPercent: await getPlayerTalentPercent(playerId),
    layerUnlock: {
      [TALENT_KIND_DIRECTION]: 2,
      [TALENT_KIND_PATH]: 3,
      [TALENT_KIND_DAOXIN]: 4,
    },
  };
}

export interface ChooseTalentResult {
  key: string;
  name: string;
  kind: string;
  message: string;
}

/** 作出抉择。每个抉择点（kind）只能选一次，重复选择会被拒绝。 */
export async function chooseTalent(
  playerId: string,
  pathKey: string,
): Promise<ChooseTalentResult> {
  const target = await db
    .select({
      key: talentPaths.key,
      name: talentPaths.name,
      kind: talentPaths.kind,
      parentKey: talentPaths.parentKey,
      unlockMajor: talentPaths.unlockMajor,
      enabled: talentPaths.enabled,
    })
    .from(talentPaths)
    .where(eq(talentPaths.key, pathKey))
    .get();

  if (!target || !target.enabled) {
    throw new Error("该流派不存在或未启用");
  }

  const options = await getAvailableTalentOptions(playerId);
  if (!options.some((option) => option.key === pathKey)) {
    const major = await getPlayerRealmMajor(playerId);
    if (Number(target.unlockMajor) > major) {
      throw new Error("境界未至，尚不能作此抉择");
    }
    throw new Error("此抉择点已定，不可更改");
  }

  const player = await db
    .select({ realm: players.realm, realmMajor: players.realmMajor })
    .from(players)
    .where(eq(players.id, playerId))
    .get();

  const existing = await db
    .select({ id: playerTalents.id })
    .from(playerTalents)
    .where(and(
      eq(playerTalents.playerId, playerId),
      eq(playerTalents.kind, target.kind),
    ))
    .get();

  if (existing) {
    throw new Error("此抉择点已定，不可更改");
  }

  await db.insert(playerTalents).values({
    playerId,
    pathKey,
    kind: target.kind,
    chosenAtRealm: Math.max(0, Number(player?.realm || 0)),
    chosenAtMajor: Math.max(1, Number(player?.realmMajor || 1)),
  }).run();

  return {
    key: target.key,
    name: target.name,
    kind: target.kind,
    message: target.kind === TALENT_KIND_DIRECTION
      ? `道途已定：${target.name}。`
      : `流派已立：${target.name}。`,
  };
}
