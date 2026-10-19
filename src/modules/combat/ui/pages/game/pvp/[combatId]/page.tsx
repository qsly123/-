"use client";

import { use } from "react";
import PvpBattlePage from "@/modules/combat/ui/pages/game/pvp/[combatId]/PvpBattlePage";

export default function Page({ params }: { params: Promise<{ combatId: string }> }) {
  const { combatId } = use(params);
  return <PvpBattlePage combatId={combatId} />;
}
