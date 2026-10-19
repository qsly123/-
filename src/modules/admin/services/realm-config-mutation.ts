import { asc, eq } from "drizzle-orm";
import type { RealmRewardRule } from "@/types/game";
import { db } from "@/db";
import { items, maps, players, quests, randomEvents, realmMajors, realmStages, skills } from "@/db/schema";
import { getRealmDisplayName, validateRewardRules } from "@/modules/character/services/realm-service";
import { publishMapStructureChanged } from "@/modules/map/services/map-structure-invalidation";

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CHINESE_UNITS = ["", "十", "百", "千"];

interface RealmStageState {
  id: number;
  majorId: number;
  minor: number;
  name: string;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[];
}

interface RealmMajorState {
  id: number;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
  stages: RealmStageState[];
}

interface RealmConfigState {
  majors: RealmMajorState[];
}

type RealmExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

interface RealmLinearMapping {
  linearToStageId: Map<number, number>;
  stageIdToLinear: Map<number, number>;
  stageInfoById: Map<number, {
    majorOrder: number;
    majorName: string;
    minor: number;
    stageName: string;
    fullName: string;
  }>;
}

interface ParsedStageInput {
  id: number | null;
  name: string;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[];
}

interface ParsedMajorInput {
  id: number | null;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
  stages: ParsedStageInput[];
}

export interface RealmStageDto {
  id: number;
  majorId: number;
  minor: number;
  name: string;
  realm: number;
  requiredXp: number;
  successRate: number;
  failXpLossRate: number;
  rewardRules: RealmRewardRule[];
}

export interface RealmMajorDto {
  id: number;
  order: number;
  name: string;
  baseHp: number;
  baseMp: number;
  baseAtk: number;
  baseDef: number;
  baseSpiritualSense: number;
  stages: RealmStageDto[];
}

function numberToChinese(value: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) {
    return "一";
  }

  if (n < 10) {
    return CHINESE_DIGITS[n];
  }

  const text = String(n);
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const unitIndex = text.length - index - 1;
    const unit = CHINESE_UNITS[unitIndex] || "";

    if (digit === 0) {
      if (!output.endsWith("零") && index !== text.length - 1) {
        output += "零";
      }
      continue;
    }

    output += `${CHINESE_DIGITS[digit]}${unit}`;
  }

  output = output.replace(/零+/g, "零").replace(/零$/g, "");
  if (output.startsWith("一十")) {
    output = output.slice(1);
  }

  return output || "一";
}

function defaultStageName(minor: number) {
  return `${numberToChinese(Math.max(1, Math.floor(minor || 1)))}重`;
}

function parseInteger(value: unknown, fieldName: string, min?: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} 必须为整数`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${fieldName} 必须大于等于 ${min}`);
  }
  return parsed;
}

function parseOptionalInteger(value: unknown, fieldName: string, min?: number) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseInteger(value, fieldName, min);
}

function parseNumberRange(value: unknown, fieldName: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} 必须在 ${min}~${max}`);
  }
  return parsed;
}

function parseRewardRules(value: unknown, fieldName: string): RealmRewardRule[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${fieldName} JSON 格式错误`);
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须为数组`);
  }

  const validateError = validateRewardRules(parsed as RealmRewardRule[]);
  if (validateError) {
    throw new Error(`${fieldName} ${validateError}`);
  }

  return parsed as RealmRewardRule[];
}

function normalizeStageInput(raw: unknown, index: number): ParsedStageInput {
  const row = index + 1;
  const obj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const id = parseOptionalInteger(obj.id, `第 ${row} 条小境界 id`, 1);
  const nameRaw = String(obj.name || "").trim();
  const name = nameRaw || defaultStageName(row);

  return {
    id,
    name,
    requiredXp: parseInteger(obj.requiredXp, `第 ${row} 条突破修为`, 0),
    successRate: parseNumberRange(obj.successRate, `第 ${row} 条突破成功率`, 0, 1),
    failXpLossRate: parseNumberRange(obj.failXpLossRate, `第 ${row} 条失败修为损失率`, 0, 1),
    rewardRules: parseRewardRules(obj.rewardRules, `第 ${row} 条奖励规则`),
  };
}

function normalizeMajorInput(
  raw: unknown,
  options: {
    requireId: boolean;
    allowId: boolean;
    allowEmptyStages: boolean;
    fieldPrefix: string;
  }
): ParsedMajorInput {
  const obj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const id = parseOptionalInteger(obj.id, `${options.fieldPrefix}大境界 id`, 1);

  if (options.requireId && id === null) {
    throw new Error(`${options.fieldPrefix}缺少大境界 id`);
  }
  if (!options.allowId && id !== null) {
    throw new Error(`${options.fieldPrefix}新增大境界不允许传入 id`);
  }

  const stagesRaw = Array.isArray(obj.stages) ? obj.stages : [];
  if (!options.allowEmptyStages && stagesRaw.length < 1) {
    throw new Error(`${options.fieldPrefix}至少需要 1 条小境界`);
  }

  const stages = stagesRaw.map((item, index) => normalizeStageInput(item, index));

  return {
    id,
    order: parseInteger(obj.order, `${options.fieldPrefix}大境界顺序`, 1),
    name: String(obj.name || "").trim(),
    baseHp: parseInteger(obj.baseHp, `${options.fieldPrefix}基础气血`, 1),
    baseMp: parseInteger(obj.baseMp, `${options.fieldPrefix}基础灵力`, 1),
    baseAtk: parseInteger(obj.baseAtk, `${options.fieldPrefix}基础攻击`, 1),
    baseDef: parseInteger(obj.baseDef, `${options.fieldPrefix}基础防御`, 1),
    baseSpiritualSense: parseInteger(obj.baseSpiritualSense ?? 0, `${options.fieldPrefix}基础神识`, 0),
    stages,
  };
}

async function loadRealmState(executor: RealmExecutor): Promise<RealmConfigState> {
  const majorRows = await executor.select().from(realmMajors).orderBy(asc(realmMajors.order)).all();
  const stageRows = await executor.select().from(realmStages)
    .orderBy(asc(realmStages.majorId), asc(realmStages.minor))
    .all();

  const stagesByMajorId = new Map<number, RealmStageState[]>();
  for (const row of stageRows) {
    const majorId = Number(row.majorId);
    if (!stagesByMajorId.has(majorId)) {
      stagesByMajorId.set(majorId, []);
    }

    stagesByMajorId.get(majorId)?.push({
      id: Number(row.id),
      majorId,
      minor: Number(row.minor),
      name: String(row.name || "").trim() || defaultStageName(Number(row.minor)),
      requiredXp: Number(row.requiredXp),
      successRate: Number(row.successRate),
      failXpLossRate: Number(row.failXpLossRate),
      rewardRules: Array.isArray(row.rewardRules) ? row.rewardRules : [],
    });
  }

  const majors = majorRows.map((row) => ({
    id: Number(row.id),
    order: Number(row.order),
    name: String(row.name),
    baseHp: Number(row.baseHp),
    baseMp: Number(row.baseMp),
    baseAtk: Number(row.baseAtk),
    baseDef: Number(row.baseDef),
    baseSpiritualSense: Number(row.baseSpiritualSense || 0),
    stages: (stagesByMajorId.get(Number(row.id)) || [])
      .slice()
      .sort((left, right) => left.minor - right.minor),
  }));

  return { majors };
}

function ensureStateInvariant(state: RealmConfigState) {
  if (state.majors.length < 1) {
    throw new Error("系统至少需要保留 1 个大境界");
  }

  for (const major of state.majors) {
    if (!major.name.trim()) {
      throw new Error(`大境界 id ${major.id} 名称不能为空`);
    }
    if (major.stages.length < 1) {
      throw new Error(`大境界 ${major.name} 至少需要 1 个小境界`);
    }
  }
}

function buildLinearMapping(state: RealmConfigState): RealmLinearMapping {
  const majors = state.majors.slice().sort((left, right) => left.order - right.order);

  const linearToStageId = new Map<number, number>();
  const stageIdToLinear = new Map<number, number>();
  const stageInfoById = new Map<number, {
    majorOrder: number;
    majorName: string;
    minor: number;
    stageName: string;
    fullName: string;
  }>();

  let linear = 1;
  for (const major of majors) {
    const sortedStages = major.stages.slice().sort((left, right) => left.minor - right.minor);
    for (const stage of sortedStages) {
      linearToStageId.set(linear, stage.id);
      stageIdToLinear.set(stage.id, linear);
      stageInfoById.set(stage.id, {
        majorOrder: major.order,
        majorName: major.name,
        minor: stage.minor,
        stageName: stage.name,
        fullName: getRealmDisplayName(major.name, stage.name, stage.minor),
      });
      linear += 1;
    }
  }

  return {
    linearToStageId,
    stageIdToLinear,
    stageInfoById,
  };
}

function buildStatePositionMap(state: RealmConfigState) {
  const map = new Map<string, number>();
  for (const major of state.majors) {
    for (const stage of major.stages) {
      map.set(`${major.order}:${stage.minor}`, stage.id);
    }
  }
  return map;
}

function remapRealmValue(
  value: number | null,
  oldMapping: RealmLinearMapping,
  newMapping: RealmLinearMapping
) {
  if (value === null || value === undefined) {
    return value;
  }

  const oldLinear = Number(value);
  if (!Number.isInteger(oldLinear) || oldLinear < 1) {
    return oldLinear;
  }

  const stageId = oldMapping.linearToStageId.get(oldLinear);
  if (!stageId) {
    return oldLinear;
  }

  return newMapping.stageIdToLinear.get(stageId) || oldLinear;
}

async function assertDeletedStagesNotReferenced(
  executor: RealmExecutor,
  oldState: RealmConfigState,
  deletedStageIds: number[]
) {
  if (!deletedStageIds.length) {
    return;
  }

  const oldMapping = buildLinearMapping(oldState);
  const deletedLinearSet = new Set<number>();
  for (const stageId of deletedStageIds) {
    const linear = oldMapping.stageIdToLinear.get(stageId);
    if (linear) {
      deletedLinearSet.add(linear);
    }
  }

  if (!deletedLinearSet.size) {
    return;
  }

  const hits: string[] = [];

  const playerRows = await executor.select({ id: players.id, realm: players.realm }).from(players).all();
  for (const row of playerRows) {
    if (deletedLinearSet.has(Number(row.realm))) {
      hits.push(`players:${row.id}:realm=${row.realm}`);
    }
  }

  const mapRows = await executor.select({ id: maps.id, minRealm: maps.minRealm }).from(maps).all();
  for (const row of mapRows) {
    if (deletedLinearSet.has(Number(row.minRealm))) {
      hits.push(`maps:${row.id}:minRealm=${row.minRealm}`);
    }
  }

  const itemRows = await executor.select({ id: items.id, minRealm: items.minRealm, maxRealm: items.maxRealm }).from(items).all();
  for (const row of itemRows) {
    if (row.minRealm !== null && deletedLinearSet.has(Number(row.minRealm))) {
      hits.push(`items:${row.id}:minRealm=${row.minRealm}`);
    }
    if (row.maxRealm !== null && deletedLinearSet.has(Number(row.maxRealm))) {
      hits.push(`items:${row.id}:maxRealm=${row.maxRealm}`);
    }
  }

  const skillRows = await executor.select({ id: skills.id, minRealm: skills.minRealm, maxRealm: skills.maxRealm }).from(skills).all();
  for (const row of skillRows) {
    if (row.minRealm !== null && deletedLinearSet.has(Number(row.minRealm))) {
      hits.push(`skills:${row.id}:minRealm=${row.minRealm}`);
    }
    if (row.maxRealm !== null && deletedLinearSet.has(Number(row.maxRealm))) {
      hits.push(`skills:${row.id}:maxRealm=${row.maxRealm}`);
    }
  }

  const questRows = await executor.select({ id: quests.id, minRealm: quests.minRealm, maxRealm: quests.maxRealm }).from(quests).all();
  for (const row of questRows) {
    if (deletedLinearSet.has(Number(row.minRealm))) {
      hits.push(`quests:${row.id}:minRealm=${row.minRealm}`);
    }
    if (row.maxRealm !== null && deletedLinearSet.has(Number(row.maxRealm))) {
      hits.push(`quests:${row.id}:maxRealm=${row.maxRealm}`);
    }
  }

  const randomEventRows = await executor.select({ id: randomEvents.id, minRealm: randomEvents.minRealm, maxRealm: randomEvents.maxRealm })
    .from(randomEvents)
    .all();
  for (const row of randomEventRows) {
    if (deletedLinearSet.has(Number(row.minRealm))) {
      hits.push(`randomEvents:${row.id}:minRealm=${row.minRealm}`);
    }
    if (row.maxRealm !== null && deletedLinearSet.has(Number(row.maxRealm))) {
      hits.push(`randomEvents:${row.id}:maxRealm=${row.maxRealm}`);
    }
  }

  if (hits.length) {
    const preview = hits.slice(0, 8).join("；");
    const suffix = hits.length > 8 ? `；另有 ${hits.length - 8} 处` : "";
    throw new Error(`删除失败，存在直接引用：${preview}${suffix}`);
  }
}

async function remapRealmReferences(
  executor: RealmExecutor,
  oldState: RealmConfigState,
  newState: RealmConfigState
) {
  const oldMapping = buildLinearMapping(oldState);
  const newMapping = buildLinearMapping(newState);
  const oldPositionMap = buildStatePositionMap(oldState);
  const changedMapIds: string[] = [];

  const now = new Date().toISOString();

  const playerRows = await executor.select({
    id: players.id,
    realm: players.realm,
    realmMajor: players.realmMajor,
    realmMinor: players.realmMinor,
    realmName: players.realmName,
  }).from(players).all();

  for (const row of playerRows) {
    const realm = Number(row.realm);
    let stageId = oldMapping.linearToStageId.get(realm);
    if (!stageId) {
      stageId = oldPositionMap.get(`${Number(row.realmMajor || 1)}:${Number(row.realmMinor || 1)}`);
    }

    if (!stageId) {
      continue;
    }

    const nextRealm = newMapping.stageIdToLinear.get(stageId);
    const nextInfo = newMapping.stageInfoById.get(stageId);
    if (!nextRealm || !nextInfo) {
      continue;
    }

    const nextName = nextInfo.fullName;
    const nextMajor = nextInfo.majorOrder;
    const nextMinor = nextInfo.minor;

    if (
      nextRealm !== Number(row.realm)
      || nextMajor !== Number(row.realmMajor)
      || nextMinor !== Number(row.realmMinor)
      || nextName !== String(row.realmName || "")
    ) {
      await executor.update(players).set({
        realm: nextRealm,
        realmMajor: nextMajor,
        realmMinor: nextMinor,
        realmName: nextName,
        updatedAt: now,
      }).where(eq(players.id, row.id)).run();
    }
  }

  const mapRows = await executor.select({ id: maps.id, minRealm: maps.minRealm }).from(maps).all();
  for (const row of mapRows) {
    const nextMinRealm = remapRealmValue(Number(row.minRealm), oldMapping, newMapping);
    if (nextMinRealm !== Number(row.minRealm)) {
      await executor.update(maps).set({ minRealm: Number(nextMinRealm) }).where(eq(maps.id, row.id)).run();
      changedMapIds.push(row.id);
    }
  }

  const itemRows = await executor.select({ id: items.id, minRealm: items.minRealm, maxRealm: items.maxRealm }).from(items).all();
  for (const row of itemRows) {
    const nextMinRealm = remapRealmValue(row.minRealm === null ? null : Number(row.minRealm), oldMapping, newMapping);
    const nextMaxRealm = remapRealmValue(row.maxRealm === null ? null : Number(row.maxRealm), oldMapping, newMapping);

    if (nextMinRealm !== row.minRealm || nextMaxRealm !== row.maxRealm) {
      await executor.update(items).set({
        minRealm: nextMinRealm === null ? null : Number(nextMinRealm),
        maxRealm: nextMaxRealm === null ? null : Number(nextMaxRealm),
      }).where(eq(items.id, row.id)).run();
    }
  }

  const skillRows = await executor.select({ id: skills.id, minRealm: skills.minRealm, maxRealm: skills.maxRealm }).from(skills).all();
  for (const row of skillRows) {
    const nextMinRealm = remapRealmValue(row.minRealm === null ? null : Number(row.minRealm), oldMapping, newMapping);
    const nextMaxRealm = remapRealmValue(row.maxRealm === null ? null : Number(row.maxRealm), oldMapping, newMapping);

    if (nextMinRealm !== row.minRealm || nextMaxRealm !== row.maxRealm) {
      await executor.update(skills).set({
        minRealm: nextMinRealm === null ? null : Number(nextMinRealm),
        maxRealm: nextMaxRealm === null ? null : Number(nextMaxRealm),
      }).where(eq(skills.id, row.id)).run();
    }
  }

  const questRows = await executor.select({ id: quests.id, minRealm: quests.minRealm, maxRealm: quests.maxRealm }).from(quests).all();
  for (const row of questRows) {
    const nextMinRealm = remapRealmValue(Number(row.minRealm), oldMapping, newMapping);
    const nextMaxRealm = remapRealmValue(row.maxRealm === null ? null : Number(row.maxRealm), oldMapping, newMapping);

    if (nextMinRealm !== Number(row.minRealm) || nextMaxRealm !== row.maxRealm) {
      await executor.update(quests).set({
        minRealm: Number(nextMinRealm),
        maxRealm: nextMaxRealm === null ? null : Number(nextMaxRealm),
      }).where(eq(quests.id, row.id)).run();
    }
  }

  const randomEventRows = await executor.select({ id: randomEvents.id, minRealm: randomEvents.minRealm, maxRealm: randomEvents.maxRealm })
    .from(randomEvents)
    .all();
  for (const row of randomEventRows) {
    const nextMinRealm = remapRealmValue(Number(row.minRealm), oldMapping, newMapping);
    const nextMaxRealm = remapRealmValue(row.maxRealm === null ? null : Number(row.maxRealm), oldMapping, newMapping);

    if (nextMinRealm !== Number(row.minRealm) || nextMaxRealm !== row.maxRealm) {
      await executor.update(randomEvents).set({
        minRealm: Number(nextMinRealm),
        maxRealm: nextMaxRealm === null ? null : Number(nextMaxRealm),
      }).where(eq(randomEvents.id, row.id)).run();
    }
  }

  return changedMapIds;
}

function ensureUniqueMajorOrders(majors: ParsedMajorInput[]) {
  const orderSet = new Set<number>();
  for (const major of majors) {
    if (orderSet.has(major.order)) {
      throw new Error("大境界顺序不能重复");
    }
    orderSet.add(major.order);
  }
}

function ensureMajorName(major: ParsedMajorInput, fieldPrefix: string) {
  if (!major.name.trim()) {
    throw new Error(`${fieldPrefix}大境界名称不能为空`);
  }
}

function normalizeMajorsResponse(state: RealmConfigState): RealmMajorDto[] {
  const mapping = buildLinearMapping(state);

  return state.majors
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((major) => ({
      id: major.id,
      order: major.order,
      name: major.name,
      baseHp: major.baseHp,
      baseMp: major.baseMp,
      baseAtk: major.baseAtk,
      baseDef: major.baseDef,
      baseSpiritualSense: major.baseSpiritualSense,
      stages: major.stages
        .slice()
        .sort((left, right) => left.minor - right.minor)
        .map((stage) => ({
          id: stage.id,
          majorId: stage.majorId,
          minor: stage.minor,
          name: stage.name,
          realm: mapping.stageIdToLinear.get(stage.id) || 1,
          requiredXp: stage.requiredXp,
          successRate: stage.successRate,
          failXpLossRate: stage.failXpLossRate,
          rewardRules: stage.rewardRules,
        })),
    }));
}

export async function listRealmConfigMajors(): Promise<RealmMajorDto[]> {
  const state = await loadRealmState(db);
  return normalizeMajorsResponse(state);
}

function normalizeCreateMajorPayload(raw: unknown): ParsedMajorInput {
  const normalized = normalizeMajorInput(raw, {
    requireId: false,
    allowId: false,
    allowEmptyStages: true,
    fieldPrefix: "",
  });

  ensureMajorName(normalized, "");

  if (!normalized.stages.length) {
    normalized.stages = [{
      id: null,
      name: defaultStageName(1),
      requiredXp: 100,
      successRate: 0.9,
      failXpLossRate: 0.2,
      rewardRules: [],
    }];
  }

  return normalized;
}

function normalizeUpdateMajorPayload(raw: unknown): ParsedMajorInput {
  const normalized = normalizeMajorInput(raw, {
    requireId: true,
    allowId: true,
    allowEmptyStages: false,
    fieldPrefix: "",
  });

  ensureMajorName(normalized, "");
  return normalized;
}

async function saveMajorStages(
  executor: RealmExecutor,
  majorId: number,
  stages: ParsedStageInput[]
) {
  if (!stages.length) {
    throw new Error("每个大境界至少保留 1 个小境界");
  }

  const existingStages = await executor.select().from(realmStages)
    .where(eq(realmStages.majorId, majorId))
    .orderBy(asc(realmStages.minor))
    .all();
  const existingStageMap = new Map<number, typeof existingStages[number]>();
  for (const stage of existingStages) {
    existingStageMap.set(Number(stage.id), stage);
  }

  const seenIds = new Set<number>();
  for (const [index, stage] of stages.entries()) {
    const minor = index + 1;
    if (stage.id !== null) {
      const existing = existingStageMap.get(stage.id);
      if (!existing || Number(existing.majorId) !== majorId) {
        throw new Error(`小境界 id ${stage.id} 不属于当前大境界`);
      }
      if (seenIds.has(stage.id)) {
        throw new Error(`小境界 id ${stage.id} 重复`);
      }
      seenIds.add(stage.id);

      await executor.update(realmStages).set({
        minor,
        name: stage.name,
        requiredXp: stage.requiredXp,
        successRate: stage.successRate,
        failXpLossRate: stage.failXpLossRate,
        rewardRules: stage.rewardRules,
        updatedAt: new Date().toISOString(),
      }).where(eq(realmStages.id, stage.id)).run();
      continue;
    }

    await executor.insert(realmStages).values({
      majorId,
      minor,
      name: stage.name,
      requiredXp: stage.requiredXp,
      successRate: stage.successRate,
      failXpLossRate: stage.failXpLossRate,
      rewardRules: stage.rewardRules,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
  }

  for (const stage of existingStages) {
    const stageId = Number(stage.id);
    if (!seenIds.has(stageId)) {
      await executor.delete(realmStages).where(eq(realmStages.id, stageId)).run();
    }
  }
}

export async function createRealmMajor(raw: unknown): Promise<RealmMajorDto> {
  const major = normalizeCreateMajorPayload(raw);

  const result = await db.transaction(async (tx) => {
    const oldState = await loadRealmState(tx);

    const duplicateOrder = oldState.majors.find((item) => item.order === major.order);
    if (duplicateOrder) {
      throw new Error("大境界顺序已存在");
    }

    const now = new Date().toISOString();
    const inserted = await tx.insert(realmMajors).values({
      order: major.order,
      name: major.name,
      baseHp: major.baseHp,
      baseMp: major.baseMp,
      baseAtk: major.baseAtk,
      baseDef: major.baseDef,
      baseSpiritualSense: major.baseSpiritualSense,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: realmMajors.id }).get();

    const majorId = Number(inserted?.id || 0);
    if (!majorId) {
      throw new Error("新增大境界失败");
    }

    await saveMajorStages(tx, majorId, major.stages);

    const newState = await loadRealmState(tx);
    ensureStateInvariant(newState);
    const changedMapIds = await remapRealmReferences(tx, oldState, newState);

    const target = normalizeMajorsResponse(newState).find((item) => item.id === majorId);
    if (!target) {
      throw new Error("新增后读取失败");
    }

    return { target, changedMapIds };
  });
  publishMapStructureChanged({
    mapIds: result.changedMapIds,
    source: "realm-config-create",
  });
  return result.target;
}

export async function updateRealmMajor(raw: unknown): Promise<RealmMajorDto> {
  const payload = normalizeUpdateMajorPayload(raw);
  if (payload.id === null) {
    throw new Error("缺少大境界 id");
  }
  const majorId = payload.id;

  const result = await db.transaction(async (tx) => {
    const oldState = await loadRealmState(tx);
    ensureStateInvariant(oldState);

    const currentMajor = oldState.majors.find((item) => item.id === majorId);
    if (!currentMajor) {
      throw new Error("大境界不存在");
    }

    const duplicateOrder = oldState.majors.find((item) => item.order === payload.order && item.id !== majorId);
    if (duplicateOrder) {
      throw new Error("大境界顺序已存在");
    }

    const existingStageIds = new Set<number>(currentMajor.stages.map((stage) => stage.id));
    const payloadExistingStageIds = new Set<number>();
    for (const stage of payload.stages) {
      if (stage.id === null) {
        continue;
      }
      if (!existingStageIds.has(stage.id)) {
        throw new Error(`小境界 id ${stage.id} 不属于当前大境界`);
      }
      if (payloadExistingStageIds.has(stage.id)) {
        throw new Error(`小境界 id ${stage.id} 重复`);
      }
      payloadExistingStageIds.add(stage.id);
    }

    const deletedStageIds = currentMajor.stages
      .map((stage) => stage.id)
      .filter((stageId) => !payloadExistingStageIds.has(stageId));

    await assertDeletedStagesNotReferenced(tx, oldState, deletedStageIds);

    await tx.update(realmMajors).set({
      order: payload.order,
      name: payload.name,
      baseHp: payload.baseHp,
      baseMp: payload.baseMp,
      baseAtk: payload.baseAtk,
      baseDef: payload.baseDef,
      baseSpiritualSense: payload.baseSpiritualSense,
      updatedAt: new Date().toISOString(),
    }).where(eq(realmMajors.id, majorId)).run();

    await saveMajorStages(tx, majorId, payload.stages);

    const newState = await loadRealmState(tx);
    ensureStateInvariant(newState);
    const changedMapIds = await remapRealmReferences(tx, oldState, newState);

    const target = normalizeMajorsResponse(newState).find((item) => item.id === majorId);
    if (!target) {
      throw new Error("保存后读取失败");
    }

    return { target, changedMapIds };
  });
  publishMapStructureChanged({
    mapIds: result.changedMapIds,
    source: "realm-config-update",
  });
  return result.target;
}

export async function deleteRealmMajor(majorIdValue: unknown) {
  const majorId = parseInteger(majorIdValue, "大境界 id", 1);

  const result = await db.transaction(async (tx) => {
    const oldState = await loadRealmState(tx);
    ensureStateInvariant(oldState);

    if (oldState.majors.length <= 1) {
      throw new Error("系统至少需要保留 1 个大境界");
    }

    const currentMajor = oldState.majors.find((item) => item.id === majorId);
    if (!currentMajor) {
      throw new Error("大境界不存在");
    }

    const deletedStageIds = currentMajor.stages.map((item) => item.id);
    await assertDeletedStagesNotReferenced(tx, oldState, deletedStageIds);

    await tx.delete(realmStages).where(eq(realmStages.majorId, majorId)).run();
    await tx.delete(realmMajors).where(eq(realmMajors.id, majorId)).run();

    const newState = await loadRealmState(tx);
    ensureStateInvariant(newState);
    const changedMapIds = await remapRealmReferences(tx, oldState, newState);

    return { id: majorId, changedMapIds };
  });
  publishMapStructureChanged({
    mapIds: result.changedMapIds,
    source: "realm-config-delete",
  });
  return { id: result.id };
}

function normalizeImportPayload(body: unknown): ParsedMajorInput[] {
  const list = Array.isArray(body)
    ? body
    : (body && typeof body === "object" && Array.isArray((body as { majors?: unknown[] }).majors)
      ? (body as { majors: unknown[] }).majors
      : null);

  if (!list) {
    throw new Error("请求体必须是 JSON 数组");
  }
  if (!list.length) {
    throw new Error("导入数据不能为空");
  }

  return list.map((item, index) => {
    const major = normalizeMajorInput(item, {
      requireId: false,
      allowId: true,
      allowEmptyStages: false,
      fieldPrefix: `第 ${index + 1} 项`,
    });
    ensureMajorName(major, `第 ${index + 1} 项`);
    return major;
  });
}

export async function importRealmConfig(raw: unknown) {
  const targetMajors = normalizeImportPayload(raw);
  ensureUniqueMajorOrders(targetMajors);

  const result = await db.transaction(async (tx) => {
    const oldState = await loadRealmState(tx);

    const oldMajorMap = new Map<number, RealmMajorState>(oldState.majors.map((major) => [major.id, major]));
    const seenMajorIds = new Set<number>();

    for (const major of targetMajors) {
      if (major.id === null) {
        continue;
      }
      if (!oldMajorMap.has(major.id)) {
        throw new Error(`大境界 id ${major.id} 不存在`);
      }
      if (seenMajorIds.has(major.id)) {
        throw new Error(`大境界 id ${major.id} 重复`);
      }
      seenMajorIds.add(major.id);
    }

    const deletedMajorIds = oldState.majors
      .map((major) => major.id)
      .filter((majorId) => !seenMajorIds.has(majorId));

    const deletedStageIds: number[] = [];
    for (const majorId of deletedMajorIds) {
      const major = oldMajorMap.get(majorId);
      if (!major) {
        continue;
      }
      for (const stage of major.stages) {
        deletedStageIds.push(stage.id);
      }
    }

    for (const major of targetMajors) {
      if (major.id === null) {
        for (const stage of major.stages) {
          if (stage.id !== null) {
            throw new Error("新增大境界的小境界不允许传入 id");
          }
        }
        continue;
      }

      const oldMajor = oldMajorMap.get(major.id);
      if (!oldMajor) {
        continue;
      }

      const oldStageIds = new Set<number>(oldMajor.stages.map((stage) => stage.id));
      const seenStageIds = new Set<number>();
      for (const stage of major.stages) {
        if (stage.id === null) {
          continue;
        }
        if (!oldStageIds.has(stage.id)) {
          throw new Error(`小境界 id ${stage.id} 不属于大境界 id ${major.id}`);
        }
        if (seenStageIds.has(stage.id)) {
          throw new Error(`大境界 id ${major.id} 下小境界 id ${stage.id} 重复`);
        }
        seenStageIds.add(stage.id);
      }

      for (const stageId of oldStageIds) {
        if (!seenStageIds.has(stageId)) {
          deletedStageIds.push(stageId);
        }
      }
    }

    await assertDeletedStagesNotReferenced(tx, oldState, deletedStageIds);

    for (const majorId of deletedMajorIds) {
      await tx.delete(realmStages).where(eq(realmStages.majorId, majorId)).run();
      await tx.delete(realmMajors).where(eq(realmMajors.id, majorId)).run();
    }

    for (const major of targetMajors) {
      if (major.id === null) {
        continue;
      }
      await tx.update(realmMajors).set({
        order: -1 * (100000 + major.id),
        updatedAt: new Date().toISOString(),
      }).where(eq(realmMajors.id, major.id)).run();
    }

    for (const major of targetMajors) {
      if (major.id === null) {
        continue;
      }
      await tx.update(realmMajors).set({
        order: major.order,
        name: major.name,
        baseHp: major.baseHp,
        baseMp: major.baseMp,
        baseAtk: major.baseAtk,
        baseDef: major.baseDef,
        baseSpiritualSense: major.baseSpiritualSense,
        updatedAt: new Date().toISOString(),
      }).where(eq(realmMajors.id, major.id)).run();
    }

    const insertedMajorIdByIndex = new Map<number, number>();
    for (const [index, major] of targetMajors.entries()) {
      if (major.id !== null) {
        continue;
      }

      const inserted = await tx.insert(realmMajors).values({
        order: major.order,
        name: major.name,
        baseHp: major.baseHp,
        baseMp: major.baseMp,
        baseAtk: major.baseAtk,
        baseDef: major.baseDef,
        baseSpiritualSense: major.baseSpiritualSense,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning({ id: realmMajors.id }).get();

      const insertedId = Number(inserted?.id || 0);
      if (!insertedId) {
        throw new Error("导入时新增大境界失败");
      }
      insertedMajorIdByIndex.set(index, insertedId);
    }

    for (const [index, major] of targetMajors.entries()) {
      const resolvedMajorId = major.id ?? insertedMajorIdByIndex.get(index);
      if (!resolvedMajorId) {
        throw new Error("导入时解析大境界失败");
      }

      await saveMajorStages(tx, resolvedMajorId, major.stages);
    }

    const newState = await loadRealmState(tx);
    ensureStateInvariant(newState);
    const changedMapIds = await remapRealmReferences(tx, oldState, newState);

    const normalized = normalizeMajorsResponse(newState);
    return {
      totalMajors: normalized.length,
      totalStages: normalized.reduce((sum, major) => sum + major.stages.length, 0),
      changedMapIds,
    };
  });
  publishMapStructureChanged({
    mapIds: result.changedMapIds,
    source: "realm-config-import",
  });
  return {
    totalMajors: result.totalMajors,
    totalStages: result.totalStages,
  };
}

export async function exportRealmConfig() {
  const majors = await listRealmConfigMajors();
  return majors.map((major) => ({
    id: major.id,
    order: major.order,
    name: major.name,
    baseHp: major.baseHp,
    baseMp: major.baseMp,
    baseAtk: major.baseAtk,
    baseDef: major.baseDef,
    baseSpiritualSense: major.baseSpiritualSense,
    stages: major.stages.map((stage) => ({
      id: stage.id,
      majorId: stage.majorId,
      minor: stage.minor,
      name: stage.name,
      requiredXp: stage.requiredXp,
      successRate: stage.successRate,
      failXpLossRate: stage.failXpLossRate,
      rewardRules: stage.rewardRules,
    })),
  }));
}
