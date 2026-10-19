import { getBuiltinDoubleCultivationSupplementalStats } from "@/modules/world/services/double-cultivation-profile-stats";
import type { PlayerStatusView } from "@/types/game";

export interface DoubleCultivationPregnancyDisplayStats {
  uterusStorageMl?: number | null;
  uterusCapacityMl?: number | null;
  pregnancyDisplayStatus?: PlayerStatusView | null;
}

export async function getDoubleCultivationPregnancyDisplayStats(
  currentPlayer: { id: string; gender?: string | null; [key: string]: unknown } | null | undefined,
) {
  if (!currentPlayer || currentPlayer.gender !== "女") {
    return null;
  }

  try {
    const stats = await getBuiltinDoubleCultivationSupplementalStats({
      playerId: currentPlayer.id,
      gender: currentPlayer.gender,
    });
    return {
      uterusStorageMl: stats.uterusStorageMl ?? null,
      uterusCapacityMl: stats.uterusCapacityMl ?? null,
      pregnancyDisplayStatus: stats.pregnancyDisplayStatus ?? null,
    } satisfies DoubleCultivationPregnancyDisplayStats;
  } catch {
    return null;
  }
}

export function mergePregnancyDisplayStatus(
  statuses: PlayerStatusView[] | null | undefined,
  pregnancyDisplayStatus?: PlayerStatusView | null,
) {
  const list = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
  if (!pregnancyDisplayStatus) {
    return list;
  }

  return [
    ...list.filter((status) => status.statusKey !== pregnancyDisplayStatus.statusKey),
    pregnancyDisplayStatus,
  ];
}
