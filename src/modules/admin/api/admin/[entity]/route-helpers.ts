import type { AdminEntity } from "@/modules/admin/services/admin-entities";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export function parsePage(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function parsePageSize(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.floor(parsed));
}

export function normalizeRowId(entity: AdminEntity, rowId: unknown) {
  if (
    entity === "mapEdges"
    || entity === "cdkCodes"
    || entity === "checkinRewardRules"
  ) {
    const parsed = Number(rowId);
    if (!Number.isFinite(parsed)) {
      throw new Error("id 非法");
    }
    return parsed;
  }

  const text = String(rowId).trim();
  if (!text) {
    throw new Error("id 非法");
  }
  return text;
}

export function normalizeRowIds(entity: AdminEntity, rowIds: unknown[]) {
  const dedup = new Set<string | number>();
  for (const rowId of rowIds) {
    const normalized = normalizeRowId(entity, rowId);
    dedup.add(normalized);
  }
  return [...dedup];
}
