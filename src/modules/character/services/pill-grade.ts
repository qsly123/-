/**
 * 丹药品级。
 *
 * 品级以「物品变体」实现：同配方炼出的丹药按品级对应不同 itemId
 * （下品 / 中品 / 上品 / 极品），中品即原物品，其余由
 * scripts/seed-pill-expansion.ts 从原物品派生（templateItemId 指回原物品）。
 * 这样服用端无需改动——不同品级本来就是不同数值的物品。
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";

export const PILL_GRADES = ["下品", "中品", "上品", "极品"] as const;
export type PillGrade = (typeof PILL_GRADES)[number];

/** 品级对应效果倍率（派生物品时用于缩放 effects）。 */
export const PILL_GRADE_MULTIPLIER: Record<PillGrade, number> = {
  下品: 0.8,
  中品: 1,
  上品: 1.3,
  极品: 1.6,
};

/** 品级物品 id 后缀，中品沿用原 id。 */
export const PILL_GRADE_ID_SUFFIX: Record<PillGrade, string> = {
  下品: "_g1",
  中品: "",
  上品: "_g3",
  极品: "_g4",
};

/**
 * 按炼丹成功率掷品级。成功率越高，越容易出上品/极品。
 * 基准分布（成功率 0.6 时）：极品 3%、上品 15%、中品 45%、下品 37%。
 */
export function rollPillGrade(successRate: number, roll: number = Math.random()): PillGrade {
  const rate = Math.min(Math.max(Number(successRate) || 0, 0), 1);
  // 高成功率把整体品质往上推，最多 +0.2
  const score = roll + (rate - 0.6) * 0.5;

  if (score > 0.97) return "极品";
  if (score > 0.82) return "上品";
  if (score > 0.37) return "中品";
  return "下品";
}

export function buildPillGradeItemId(baseItemId: string, grade: PillGrade): string {
  return `${baseItemId}${PILL_GRADE_ID_SUFFIX[grade]}`;
}

/** 品级物品未灌数据时回退到原物品，避免炼出空 id。 */
export async function resolvePillGradeItemId(
  baseItemId: string,
  grade: PillGrade,
): Promise<{ itemId: string; grade: PillGrade }> {
  if (grade === "中品") return { itemId: baseItemId, grade };

  const candidateId = buildPillGradeItemId(baseItemId, grade);
  try {
    const row = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.id, candidateId))
      .get();
    if (row) return { itemId: candidateId, grade };
  } catch {
    // 查询失败时回退
  }

  return { itemId: baseItemId, grade: "中品" };
}
