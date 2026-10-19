import {
  type PlayerWorldEventOfferItem,
  getPlayerWorldPressure,
  listPlayerWorldEventOffers as listPlayerWorldEventOffersFromPressure,
  respondPlayerWorldEventOffer as respondPlayerWorldEventOfferFromPressure,
} from "@/modules/world/services/player-world-pressure-service";

export type PlayerWorldEventOfferView = {
  id: string;
  offerType: PlayerWorldEventOfferItem["offerType"];
  sourceFaction: string;
  status: PlayerWorldEventOfferItem["status"];
  summary: string;
  tone: "low" | "medium" | "high";
  expiresAt: string;
  canRespond: boolean;
  rewards: {
    gold: number;
    lingYu: number;
  };
};

function resolveOfferTone(offer: PlayerWorldEventOfferItem): PlayerWorldEventOfferView["tone"] {
  if (offer.offerType === "demonic_temptation") {
    return "high";
  }
  if (offer.offerType === "cultivator_hunt" || /更重|追缉|见血/.test(offer.riskLabel)) {
    return "medium";
  }
  return "low";
}

function toLegacyOfferView(offer: PlayerWorldEventOfferItem): PlayerWorldEventOfferView {
  const rewardGold = Math.max(0, Number(offer.payloadJson?.rewardGold || 0));
  const rewardLingYu = Math.max(0, Number(offer.payloadJson?.rewardLingYu || 0));
  return {
    id: offer.id,
    offerType: offer.offerType,
    sourceFaction: offer.sourceFaction,
    status: offer.status,
    summary: offer.summary,
    tone: resolveOfferTone(offer),
    expiresAt: offer.expiresAt,
    canRespond: offer.status === "pending" && offer.expiresAt > new Date().toISOString(),
    rewards: {
      gold: rewardGold,
      lingYu: rewardLingYu,
    },
  };
}

export async function maybeGeneratePlayerWorldEventOffer(playerId: string) {
  const before = await listPlayerWorldEventOffersFromPressure(playerId);
  await getPlayerWorldPressure(playerId);
  const after = await listPlayerWorldEventOffersFromPressure(playerId);
  return after[0] || before[0] || null;
}

export async function listPlayerWorldEventOffers(playerId: string) {
  const offers = await listPlayerWorldEventOffersFromPressure(playerId);
  return offers.map(toLegacyOfferView);
}

export async function respondPlayerWorldEventOffer(params: {
  playerId: string;
  offerId: string;
  action: "accept" | "reject";
}) {
  const result = await respondPlayerWorldEventOfferFromPressure(params);
  return {
    offer: null,
    resultSummary: result.narrative,
    rewards: result.reward,
    worldPressure: result.worldPressure,
  };
}
