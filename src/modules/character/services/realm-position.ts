/**
 * 线性境界（1~44）↔ 大段 / 小境界 / 境界名。
 *
 * 境界是数据库配置的（realm_majors 练气/筑基/…  + realm_stages 一层/初期/…），
 * 但战斗结算、丹药折算、界面提示都要用它，每次查库太贵——这里做进程内缓存。
 *
 * 段位结构（实测）：练气 1-12（一层~圆满）、筑基 13-16、结丹 17-20、元婴 21-24……
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { realmMajors, realmStages } from "@/db/schema";

export type RealmPosition = {
  /** 线性境界 1~44，与 players.realm 同量纲 */
  realm: number;
  /** 大段序号：1=练气 2=筑基 3=结丹 4=元婴 … */
  major: number;
  /** 段内小境界：1=初期/一层，4=圆满（练气段到 12） */
  minor: number;
  majorName: string;
  minorName: string;
  /** 完整境界名，如「筑基初期」「练气三层」 */
  label: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; table: RealmPosition[] } | null = null;

async function loadTable(): Promise<RealmPosition[]> {
  const rows = await db.select({
    majorOrder: realmMajors.order,
    majorName: realmMajors.name,
    minor: realmStages.minor,
    stageName: realmStages.name,
  })
    .from(realmStages)
    .innerJoin(realmMajors, eq(realmStages.majorId, realmMajors.id))
    .orderBy(asc(realmMajors.order), asc(realmStages.minor))
    .all();

  return rows.map((row, index) => {
    const majorName = String(row.majorName || "").trim();
    const minorName = String(row.stageName || "").trim() || String(Number(row.minor) || 1);
    return {
      realm: index + 1,
      major: Number(row.majorOrder) || 1,
      minor: Number(row.minor) || 1,
      majorName,
      minorName,
      label: majorName ? `${majorName}${minorName}` : `境界 ${index + 1}`,
    };
  });
}

/** 全部境界位（下标 = realm - 1）。 */
export async function getRealmTable(): Promise<RealmPosition[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.table;
  }
  const table = await loadTable();
  if (table.length > 0) {
    cache = { at: now, table };
  }
  return table;
}

/** 取某个境界的段/小境界。境界号越界时夹到首尾。 */
export async function getRealmPosition(realm: number): Promise<RealmPosition | null> {
  const table = await getRealmTable();
  if (table.length === 0) {
    return null;
  }
  const index = Math.min(table.length, Math.max(1, Math.floor(Number(realm) || 1))) - 1;
  return table[index] ?? null;
}

/** 境界名（「筑基初期」）。查不到时退回「境界 N」，别让 UI 崩。 */
export async function getRealmLabel(realm: number): Promise<string> {
  const position = await getRealmPosition(realm);
  if (position) {
    return position.label;
  }
  return `境界 ${Math.max(1, Math.floor(Number(realm) || 1))}`;
}

/** 批量取境界名：一次拿表，避免 N 次查询。 */
export async function getRealmLabels(realms: number[]): Promise<Map<number, string>> {
  const table = await getRealmTable();
  const result = new Map<number, string>();
  for (const realm of realms) {
    if (realm === null || realm === undefined) {
      continue;
    }
    const safe = Math.max(1, Math.floor(Number(realm) || 1));
    const position = table[Math.min(table.length, safe) - 1];
    result.set(safe, position?.label ?? `境界 ${safe}`);
  }
  return result;
}
