import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  mapInstanceMembers,
  mapInstances,
  mapRealtimeEventLogs,
  maps,
  players,
  secretRealmSpawns,
  secretRealmTemplates,
} from "@/db/schema";
import {
  SECRET_REALM_PERSONAL_COOLDOWN_MS,
  SECRET_REALM_PERSONAL_PITY_THRESHOLD,
} from "@/modules/map/services/secret-realm-balance-service";
import { OPEN_WORLD_MAP_TYPE } from "@/modules/world/services/world-config";

/**
 * 线上诊断：某玩家为什么进不去秘境。
 *
 * 用法（在服务器 /opt/immortality 上，bun 会自动加载 .env.local）：
 *   bun run scripts/diagnose-secret-realm-player.ts 青里
 *   bun run scripts/diagnose-secret-realm-player.ts --id=<playerId>
 *
 * 本机（有 DATABASE_URL 时）同样可用：
 *   DATABASE_URL=postgres://... bun run scripts/diagnose-secret-realm-player.ts 青里
 */
const SECRET_REALM_INSTANCE_MAP_TYPE = "secret_realm_instance";

function nowMs() {
  return Date.now();
}

function parseIsoMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function minutesAgo(value: string | null | undefined) {
  const ms = parseIsoMs(value);
  if (!ms) return null;
  return Math.round((nowMs() - ms) / 60000);
}

function printSection(title: string, payload: unknown) {
  console.log(`\n===== ${title} =====`);
  console.log(JSON.stringify(payload, null, 2));
}

async function resolvePlayer(term: string) {
  if (term.startsWith("--id=")) {
    const playerId = term.slice("--id=".length).trim();
    const row = await db.select().from(players).where(eq(players.id, playerId)).get();
    return row ? [row] : [];
  }

  const rows = await db.select().from(players)
    .where(sql`${players.name} ILIKE ${`%${term}%`}`)
    .all();
  return rows.slice(0, 10);
}

async function main() {
  const term = process.argv.slice(2).join(" ").trim();
  if (!term) {
    console.error("用法: bun run scripts/diagnose-secret-realm-player.ts <玩家名或 --id=玩家ID>");
    process.exit(1);
  }

  const matched = await resolvePlayer(term);
  if (matched.length === 0) {
    console.error(`未找到玩家：${term}`);
    process.exit(1);
  }

  printSection("匹配到的玩家", matched.map((row) => ({
    id: row.id,
    name: row.name,
    realm: row.realm,
    currentMapId: row.currentMapId,
  })));

  if (matched.length > 1) {
    console.log("\n[提示] 匹配到多个玩家，请改用 --id=<playerId> 精确查询。");
  }

  for (const player of matched.slice(0, 1)) {
    const currentMap = player.currentMapId
      ? await db.select({
        id: maps.id,
        name: maps.name,
        mapType: maps.mapType,
      }).from(maps).where(eq(maps.id, player.currentMapId)).get()
      : null;

    printSection("玩家秘境相关字段", {
      id: player.id,
      name: player.name,
      realm: player.realm,
      currentMapId: player.currentMapId,
      currentMapName: currentMap?.name ?? null,
      currentMapType: currentMap?.mapType ?? null,
      positionX: player.positionX,
      positionY: player.positionY,
      hp: player.hp,
      currentMapInstanceId: player.currentMapInstanceId,
      secretRealmPityCounter: player.secretRealmPityCounter,
      secretRealmHongmengPityCounter: player.secretRealmHongmengPityCounter,
      secretRealmLastPersonalSpawnAt: player.secretRealmLastPersonalSpawnAt,
      personalSpawnCooldownRemainingMin: player.secretRealmLastPersonalSpawnAt
        ? Math.max(0, Math.round(
          (parseIsoMs(player.secretRealmLastPersonalSpawnAt) + SECRET_REALM_PERSONAL_COOLDOWN_MS - nowMs()) / 60000,
        ))
        : 0,
      updatedAt: player.updatedAt,
    });

    // 当前地图上的全部秘境入口（含已消散 / 已完成的，便于看残留）
    const mapSpawns = player.currentMapId
      ? await db.select({
        id: secretRealmSpawns.id,
        templateName: secretRealmTemplates.name,
        spawnType: secretRealmSpawns.spawnType,
        status: secretRealmSpawns.status,
        ownerPlayerId: secretRealmSpawns.ownerPlayerId,
        visiblePlayerIds: secretRealmSpawns.visiblePlayerIds,
        positionX: secretRealmSpawns.positionX,
        positionY: secretRealmSpawns.positionY,
        instanceId: secretRealmSpawns.instanceId,
        spawnedAt: secretRealmSpawns.spawnedAt,
        expiresAt: secretRealmSpawns.expiresAt,
        enteredAt: secretRealmSpawns.enteredAt,
        completedAt: secretRealmSpawns.completedAt,
      }).from(secretRealmSpawns)
        .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
        .where(eq(secretRealmSpawns.mapId, player.currentMapId))
        .all()
      : [];

    printSection("当前地图上的秘境入口（全部状态）", mapSpawns.map((row) => ({
      ...row,
      spawnedMinAgo: minutesAgo(row.spawnedAt),
      expired: parseIsoMs(row.expiresAt) <= nowMs(),
      isVisibleToPlayer: row.spawnType === "global"
        || row.ownerPlayerId === player.id
        || (Array.isArray(row.visiblePlayerIds) && row.visiblePlayerIds.includes(player.id)),
    })));

    // 该玩家名下的个人入口（跨地图、全部状态）
    const personalSpawns = await db.select({
      id: secretRealmSpawns.id,
      mapId: secretRealmSpawns.mapId,
      mapName: maps.name,
      templateName: secretRealmTemplates.name,
      status: secretRealmSpawns.status,
      instanceId: secretRealmSpawns.instanceId,
      spawnedAt: secretRealmSpawns.spawnedAt,
      expiresAt: secretRealmSpawns.expiresAt,
      enteredAt: secretRealmSpawns.enteredAt,
      completedAt: secretRealmSpawns.completedAt,
    }).from(secretRealmSpawns)
      .innerJoin(secretRealmTemplates, eq(secretRealmTemplates.id, secretRealmSpawns.templateId))
      .leftJoin(maps, eq(maps.id, secretRealmSpawns.mapId))
      .where(and(
        eq(secretRealmSpawns.spawnType, "personal"),
        eq(secretRealmSpawns.ownerPlayerId, player.id),
      ))
      .all();

    printSection("玩家名下的个人秘境入口（全部状态）", personalSpawns.map((row) => ({
      ...row,
      spawnedMinAgo: minutesAgo(row.spawnedAt),
      expired: parseIsoMs(row.expiresAt) <= nowMs(),
    })));

    // 关联实例状态
    const spawnInstanceIds = Array.from(new Set(
      [...mapSpawns, ...personalSpawns]
        .map((row) => row.instanceId)
        .filter((value): value is string => Boolean(value)),
    ));
    const instances = spawnInstanceIds.length > 0
      ? await db.select({
        id: mapInstances.id,
        mapId: mapInstances.mapId,
        sourceSpawnId: mapInstances.sourceSpawnId,
        instanceType: mapInstances.instanceType,
        accessType: mapInstances.accessType,
        status: mapInstances.status,
        ownerPlayerId: mapInstances.ownerPlayerId,
        sourceMapId: mapInstances.sourceMapId,
        expiresAt: mapInstances.expiresAt,
        settledAt: mapInstances.settledAt,
        completedAt: mapInstances.completedAt,
        createdAt: mapInstances.createdAt,
      }).from(mapInstances).where(inArray(mapInstances.id, spawnInstanceIds)).all()
      : [];

    printSection("关联秘境实例", instances.map((row) => ({
      ...row,
      createdMinAgo: minutesAgo(row.createdAt),
      expired: parseIsoMs(row.expiresAt) <= nowMs(),
    })));

    // 玩家在实例中的成员记录
    const memberRows = await db.select({
      instanceId: mapInstanceMembers.instanceId,
      status: mapInstanceMembers.status,
      role: mapInstanceMembers.role,
      returnMapId: mapInstanceMembers.returnMapId,
      returnPositionX: mapInstanceMembers.returnPositionX,
      returnPositionY: mapInstanceMembers.returnPositionY,
      joinedAt: mapInstanceMembers.joinedAt,
      leftAt: mapInstanceMembers.leftAt,
      lastSeenAt: mapInstanceMembers.lastSeenAt,
    }).from(mapInstanceMembers)
      .where(eq(mapInstanceMembers.playerId, player.id))
      .all();

    printSection("玩家秘境实例成员记录", memberRows.map((row) => ({
      ...row,
      joinedMinAgo: minutesAgo(row.joinedAt),
      leftMinAgo: minutesAgo(row.leftAt),
    })));

    // 幂等 / 实时事件日志（进入秘境、移动、交互）
    const eventLogs = await db.select({
      idempotencyKey: mapRealtimeEventLogs.idempotencyKey,
      roomId: mapRealtimeEventLogs.roomId,
      mapId: mapRealtimeEventLogs.mapId,
      targetMapId: mapRealtimeEventLogs.targetMapId,
      entityId: mapRealtimeEventLogs.entityId,
      actionId: mapRealtimeEventLogs.actionId,
      inputType: mapRealtimeEventLogs.inputType,
      status: mapRealtimeEventLogs.status,
      reason: mapRealtimeEventLogs.reason,
      payloadJson: mapRealtimeEventLogs.payloadJson,
      resultJson: mapRealtimeEventLogs.resultJson,
      createdAt: mapRealtimeEventLogs.createdAt,
    }).from(mapRealtimeEventLogs)
      .where(eq(mapRealtimeEventLogs.playerId, player.id))
      .orderBy(desc(mapRealtimeEventLogs.createdAt))
      .all();

    printSection("实时事件日志（最近 40 条）", eventLogs.slice(0, 40).map((row) => ({
      ...row,
      createdMinAgo: minutesAgo(row.createdAt),
    })));

    // 自动判定
    const nowIso = new Date().toISOString();
    const visibleActiveSpawns = mapSpawns.filter((row) => (
      row.status === "active"
      && parseIsoMs(row.expiresAt) > nowMs()
      && (row.spawnType === "global"
        || row.ownerPlayerId === player.id
        || (Array.isArray(row.visiblePlayerIds) && row.visiblePlayerIds.includes(player.id)))
    ));
    const stuckPersonalSpawns = personalSpawns.filter((row) => (
      row.status === "entered" || row.status === "completed"
    ));
    const staleInstanceReference = Boolean(player.currentMapInstanceId)
      && currentMap?.mapType !== SECRET_REALM_INSTANCE_MAP_TYPE;
    const personalSpawnBlocked = player.secretRealmPityCounter < SECRET_REALM_PERSONAL_PITY_THRESHOLD
      || (Boolean(player.secretRealmLastPersonalSpawnAt)
        && parseIsoMs(player.secretRealmLastPersonalSpawnAt) + SECRET_REALM_PERSONAL_COOLDOWN_MS > nowMs());
    const openWorldMap = currentMap?.mapType === OPEN_WORLD_MAP_TYPE;
    const rejectedEnterLogs = eventLogs.filter((row) => (
      row.inputType === "secret_realm_enter" && row.status === "rejected"
    ));

    printSection("自动判定", {
      nowIso,
      当前地图可见可用入口数: visibleActiveSpawns.length,
      当前地图是否开放世界地图: openWorldMap,
      开放世界地图不生成秘境入口: openWorldMap,
      残留实例引用_人已在普通地图但仍指向实例: staleInstanceReference,
      卡死的个人入口_状态为entered或completed: stuckPersonalSpawns.map((row) => ({
        id: row.id,
        status: row.status,
        enteredAt: row.enteredAt,
        instanceId: row.instanceId,
      })),
      个人入口生成被阻断: personalSpawnBlocked,
      个人入口阻断原因: [
        player.secretRealmPityCounter < SECRET_REALM_PERSONAL_PITY_THRESHOLD
          ? `secret_realm_pity_counter=${player.secretRealmPityCounter} < 阈值 ${SECRET_REALM_PERSONAL_PITY_THRESHOLD}`
          : null,
        player.secretRealmLastPersonalSpawnAt
        && parseIsoMs(player.secretRealmLastPersonalSpawnAt) + SECRET_REALM_PERSONAL_COOLDOWN_MS > nowMs()
          ? `距上次个人入口 ${minutesAgo(player.secretRealmLastPersonalSpawnAt)} 分钟，冷却 ${SECRET_REALM_PERSONAL_COOLDOWN_MS / 60000} 分钟`
          : null,
      ].filter(Boolean),
      进入秘境被拒绝的日志条数: rejectedEnterLogs.length,
      最近拒绝原因: rejectedEnterLogs.slice(0, 5).map((row) => ({
        idempotencyKey: row.idempotencyKey,
        entityId: row.entityId,
        reason: row.reason,
        createdAt: row.createdAt,
      })),
    });
  }
}

main().catch((error) => {
  console.error("[secret-realm-diagnose] failed", error);
  process.exit(1);
});
