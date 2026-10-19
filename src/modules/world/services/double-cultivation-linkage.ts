import { settleWorldNpcDoubleCultivationHostLedger } from "@/modules/world/services/double-cultivation-ledger";

export type { WorldNpcDoubleCultivationLinkageResult } from "@/modules/world/services/double-cultivation-ledger";

export async function settleWorldNpcDoubleCultivationLinkage(params: {
  playerId: string;
  targetNpcId: string;
  targetNpcName: string;
  targetNpcGender: string;
  targetNpcRealmName?: string | null;
  actionType?: string | null;
  sourceRef?: string | null;
  sourceTargetId?: string | null;
}) {
  return await settleWorldNpcDoubleCultivationHostLedger(params);
}
