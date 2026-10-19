import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  generateOpenWorldAdultAccept,
  generateOpenWorldAdultInvite,
  generateOpenWorldAdultProfile,
  generateOpenWorldAdultReject,
  generateOpenWorldAdultResult,
  generateOpenWorldCorruptionGrowth,
  generateOpenWorldCustomNpcLibrary,
  generateOpenWorldAdultRumor,
  generateOpenWorldCustomNpcPreview,
  generateOpenWorldDistrictStateFlavor,
  generateOpenWorldDistrictRumors,
  generateOpenWorldFactionTone,
  generateOpenWorldForcedConsequence,
  generateOpenWorldKeywordPool,
  generateOpenWorldMapMeta,
  generateOpenWorldNpcBark,
  generateOpenWorldNpcDnaBatch,
  generateOpenWorldNpcFactionHint,
  generateOpenWorldPartnerJealousy,
  generateOpenWorldPressureReliefOffer,
  generateOpenWorldShadowEvent,
  generateOpenWorldStorylineFlavor,
  generateOpenWorldTiandaoEvent,
} from "@/modules/world/services/world-ai-generation";
import {
  buildOpenWorldMapDrafts,
  buildOpenWorldNpcDrafts,
} from "@/modules/world/services/world-map-generator";
import { warmOpenWorldCustomNpcLibrary, getCachedOpenWorldCustomNpcLibrary } from "@/modules/world/services/world-config";
import {
  buildOpenWorldWorldBookContext,
  type OpenWorldWorldBookScene,
} from "@/modules/world/services/world-worldbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewType =
  | "worldbook_context"
  | "keyword_pool"
  | "custom_npc_library"
  | "map_meta"
  | "npc_dna"
  | "custom_npc"
  | "npc_bark"
  | "tiandao_event"
  | "district_rumor"
  | "faction_tone"
  | "district_state"
  | "storyline"
  | "npc_faction_hint"
  | "shadow_event"
  | "pressure_relief"
  | "adult_profile"
  | "adult_invite"
  | "adult_accept"
  | "adult_reject"
  | "adult_result"
  | "corruption_growth"
  | "adult_rumor"
  | "forced_consequence"
  | "partner_jealousy";

type PreviewSeed = {
  previewType: PreviewType | "";
  mapDraft: ReturnType<typeof buildOpenWorldMapDrafts>[number];
  npcDrafts: ReturnType<typeof buildOpenWorldNpcDrafts>;
  worldBookContext: Awaited<ReturnType<typeof buildOpenWorldWorldBookContext>>;
};

type PreviewNpcContext = {
  npcDnaBatch: Awaited<ReturnType<typeof generateOpenWorldNpcDnaBatch>>;
  firstNpcDraft: ReturnType<typeof buildOpenWorldNpcDrafts>[number];
  firstNpcDna: Awaited<ReturnType<typeof generateOpenWorldNpcDnaBatch>>["profiles"][string];
  firstDistrict: string | null;
};

function resolveWorldBookScene(previewType: PreviewType | ""): OpenWorldWorldBookScene {
  if (!previewType || previewType === "map_meta" || previewType === "worldbook_context") {
    return "map_meta";
  }
  if (previewType === "keyword_pool") {
    return "keyword_pool";
  }
  if (previewType === "custom_npc_library") {
    return "custom_npc";
  }
  if (previewType === "npc_dna") {
    return "npc_dna";
  }
  if (previewType === "custom_npc") {
    return "custom_npc";
  }
  if (previewType === "npc_bark") {
    return "npc_bark";
  }
  if (previewType === "tiandao_event") {
    return "tiandao_event";
  }
  if (previewType === "district_rumor") {
    return "district_rumor";
  }
  if (previewType === "faction_tone") {
    return "faction_tone";
  }
  if (previewType === "district_state") {
    return "district_state";
  }
  if (previewType === "storyline") {
    return "storyline";
  }
  if (previewType === "npc_faction_hint") {
    return "npc_faction_hint";
  }
  if (previewType === "shadow_event") {
    return "shadow_event";
  }
  if (previewType === "pressure_relief") {
    return "pressure_relief";
  }
  if (previewType === "adult_profile") {
    return "adult_profile";
  }
  if (previewType === "adult_invite") {
    return "adult_invite";
  }
  if (previewType === "adult_accept") {
    return "adult_accept";
  }
  if (previewType === "adult_reject") {
    return "adult_reject";
  }
  if (previewType === "adult_rumor") {
    return "adult_rumor";
  }
  if (previewType === "corruption_growth") {
    return "corruption_growth";
  }
  if (previewType === "forced_consequence") {
    return "forced_consequence";
  }
  if (previewType === "partner_jealousy") {
    return "partner_jealousy";
  }
  return "adult_result";
}

async function buildPreviewSeed(previewType: PreviewType | ""): Promise<PreviewSeed> {
  await warmOpenWorldCustomNpcLibrary();
  const mapDraft = buildOpenWorldMapDrafts()[0];
  const npcDrafts = buildOpenWorldNpcDrafts(mapDraft);
  const worldBookContext = await buildOpenWorldWorldBookContext({
    scene: resolveWorldBookScene(previewType),
    payload: {
      mapId: mapDraft.id,
      mapName: mapDraft.name,
      archetype: mapDraft.archetype,
      theme: mapDraft.theme,
      districts: mapDraft.districts,
      buildingTags: mapDraft.buildingTags,
      rumorSeeds: mapDraft.rumorSeeds,
      previewType: previewType || "bundle",
    },
  });

  return {
    previewType,
    mapDraft,
    npcDrafts,
    worldBookContext,
  };
}

async function buildPreviewNpcContext(seed: PreviewSeed): Promise<PreviewNpcContext> {
  const npcDnaBatch = await generateOpenWorldNpcDnaBatch({
    mapDraft: seed.mapDraft,
    npcDrafts: seed.npcDrafts.slice(0, 3),
  });
  const firstNpcDraft = seed.npcDrafts[0];
  return {
    npcDnaBatch,
    firstNpcDraft,
    firstNpcDna: npcDnaBatch.profiles[firstNpcDraft.id],
    firstDistrict: seed.mapDraft.districts[0] || null,
  };
}

async function buildSinglePreview(seed: PreviewSeed) {
  const { previewType, mapDraft, npcDrafts, worldBookContext } = seed;
  if (!previewType || previewType === "worldbook_context") {
    return {
      generatedAt: new Date().toISOString(),
      previewType: "worldbook_context",
      worldBookContext,
    };
  }

  if (previewType === "keyword_pool") {
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      worldBookContext,
    };
  }

  if (previewType === "map_meta") {
    const mapMeta = await generateOpenWorldMapMeta(mapDraft);
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      map: {
        mapId: mapDraft.id,
        mapName: mapDraft.name,
        archetype: mapDraft.archetype,
        result: mapMeta,
      },
    };
  }

  if (previewType === "custom_npc") {
    const customNpcLibrary = getCachedOpenWorldCustomNpcLibrary();
    if (customNpcLibrary.npcs.length < 1) {
      return {
        generatedAt: new Date().toISOString(),
        previewType,
        customNpcPreview: {
          source: "fallback",
          summary: "当前自定义 NPC 库还是空的，先补一条可视化 NPC 配置再来预览会更直观。",
          entries: [],
        },
      };
    }
    const customNpcPreview = await generateOpenWorldCustomNpcPreview({
      mapName: mapDraft.name,
      mapArchetype: mapDraft.archetype,
      entries: customNpcLibrary.npcs.slice(0, 3).map((npc) => ({
        npcId: npc.id,
        name: npc.name,
        faction: npc.faction,
        profession: npc.profession,
        preferredMapIds: npc.preferredMapIds,
        preferredMapTags: npc.preferredMapTags,
      })),
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      customNpcPreview,
    };
  }

  let npcContext: PreviewNpcContext | null = null;
  const getNpcContext = async () => {
    if (!npcContext) {
      npcContext = await buildPreviewNpcContext(seed);
    }
    return npcContext;
  };

  if (previewType === "npc_dna") {
    const { npcDnaBatch } = await getNpcContext();
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      npcDnaBatch: {
        source: npcDnaBatch.source,
        profiles: npcDrafts.slice(0, 3).map((npcDraft) => ({
          npcId: npcDraft.id,
          name: npcDraft.name,
          profile: npcDnaBatch.profiles[npcDraft.id],
        })),
      },
    };
  }

  const {
    firstNpcDraft,
    firstNpcDna,
    firstDistrict,
  } = await getNpcContext();

  if (previewType === "npc_bark") {
    const bark = await generateOpenWorldNpcBark({
      seed: `${mapDraft.seed}:preview:bark`,
      mapName: mapDraft.name,
      mapArchetype: mapDraft.archetype,
      currentDistrictName: firstDistrict,
      npcName: firstNpcDraft.name,
      profession: firstNpcDna?.profession || firstNpcDraft.profession,
      realmName: firstNpcDraft.realmName,
      personalitySummary: firstNpcDna?.personalitySummary || firstNpcDraft.personalitySummary,
      currentActionLabel: firstNpcDraft.runtime.currentActionLabel,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      bark,
    };
  }

  if (previewType === "tiandao_event") {
    const tiandaoEvent = await generateOpenWorldTiandaoEvent({
      eventType: "preview",
      mapName: mapDraft.name,
      mapArchetype: mapDraft.archetype,
      actorName: firstNpcDraft.name,
      detail: `${firstNpcDraft.name}在 ${mapDraft.name} 附近留下了一段新的命数回响。`,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      tiandaoEvent,
    };
  }

  if (previewType === "district_rumor") {
    const mapMeta = await generateOpenWorldMapMeta(mapDraft);
    const districtRumors = await generateOpenWorldDistrictRumors({
      mapName: mapDraft.name,
      mapArchetype: mapDraft.archetype,
      theme: mapMeta.theme,
      districts: mapMeta.districts,
      rumorSeeds: mapMeta.rumorSeeds,
      resourceThemes: mapMeta.resourceThemes,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      districtRumors,
    };
  }

  if (previewType === "faction_tone") {
    const factionTone = await generateOpenWorldFactionTone({
      factionName: firstNpcDna?.faction || firstNpcDraft.faction,
      categoryLabel: "灰线商会",
      districtName: firstDistrict,
      standingSummary: "这股势力更愿意接近有风声、有灰活、又不算彻底失控的人。",
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      factionTone,
    };
  }

  if (previewType === "district_state") {
    const districtStateFlavor = await generateOpenWorldDistrictStateFlavor({
      districtName: firstDistrict || "无名街区",
      dominantFactionName: firstNpcDna?.faction || firstNpcDraft.faction,
      tensionTag: "暗潮压街",
      hotspotSummary: `${mapDraft.name}近来人心浮动，几条路数已经悄悄碰在一起。`,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      districtStateFlavor,
    };
  }

  if (previewType === "storyline") {
    const storylineFlavor = await generateOpenWorldStorylineFlavor({
      districtName: firstDistrict || "无名街区",
      storylineTypeLabel: "灰线渗透链",
      sourceFactionName: firstNpcDna?.faction || firstNpcDraft.faction,
      stageLabel: "递信试水",
      summary: "有人开始沿着街区散口风，想看看谁会接这条线。",
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      storylineFlavor,
    };
  }

  if (previewType === "npc_faction_hint") {
    const npcFactionHint = await generateOpenWorldNpcFactionHint({
      npcName: firstNpcDraft.name,
      surfaceFaction: firstNpcDna?.faction || firstNpcDraft.faction,
      districtName: firstDistrict,
      realmName: firstNpcDraft.realmName,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      npcFactionHint,
    };
  }

  if (previewType === "shadow_event") {
    const shadowEvent = await generateOpenWorldShadowEvent({
      offerType: "shadow_intel",
      mapName: mapDraft.name,
      sourceFaction: firstNpcDna?.faction || firstNpcDraft.faction,
      playerTitle: "行踪惹眼的修士",
      pressureSummary: "风声渐起，仍未到明面悬赏。",
      hook: "有人愿意卖你一条关于追缉链的暗线情报。",
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      shadowEvent,
    };
  }

  if (previewType === "pressure_relief") {
    const pressureRelief = await generateOpenWorldPressureReliefOffer({
      offerType: "consensual_dual_cultivation",
      mapName: mapDraft.name,
      sourceFaction: firstNpcDna?.faction || firstNpcDraft.faction,
      playerTitle: "风声未散的修士",
      pressureSummary: "你身上还压着几分守序戒心与街巷余波。",
      hook: "有人提出一条能快速洗散风声的合意双修门路，但必须双方都点头。",
      keywordRuleSummary: "关键词要求：合意、双修、洗痕。",
      consentSummary: "必须明确接受后才会继续。",
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      pressureRelief,
    };
  }

  let adultProfilePromise: Promise<Awaited<ReturnType<typeof generateOpenWorldAdultProfile>>> | null = null;
  const getAdultProfile = async () => {
    if (!adultProfilePromise) {
      adultProfilePromise = generateOpenWorldAdultProfile({
        npcName: firstNpcDraft.name,
        mapName: mapDraft.name,
        mapArchetype: mapDraft.archetype,
        faction: firstNpcDna?.faction || firstNpcDraft.faction,
        profession: firstNpcDna?.profession || firstNpcDraft.profession,
        personalitySummary: firstNpcDna?.personalitySummary || firstNpcDraft.personalitySummary,
        traitTags: firstNpcDna?.traitTags || firstNpcDraft.traitTags,
        corruptionValue: 46,
      });
    }
    return adultProfilePromise;
  };

  if (previewType === "adult_profile") {
    const adultProfile = await getAdultProfile();
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      adultProfile,
    };
  }

  let adultInvitePromise: Promise<Awaited<ReturnType<typeof generateOpenWorldAdultInvite>>> | null = null;
  const getAdultInvite = async () => {
    if (!adultInvitePromise) {
      const adultProfile = await getAdultProfile();
      adultInvitePromise = generateOpenWorldAdultInvite({
        npcName: firstNpcDraft.name,
        mapName: mapDraft.name,
        districtName: firstDistrict,
        actionType: "dual_cultivation",
        dispositionLabel: adultProfile.dispositionLabel,
        moodHint: adultProfile.summary,
      });
    }
    return adultInvitePromise;
  };

  if (previewType === "adult_invite") {
    const adultInvite = await getAdultInvite();
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      adultInvite,
    };
  }

  if (previewType === "adult_accept") {
    const adultInvite = await getAdultInvite();
    const adultAccept = await generateOpenWorldAdultAccept({
      npcName: firstNpcDraft.name,
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dual_cultivation",
      atmosphereHint: adultInvite.atmosphere,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      adultAccept,
    };
  }

  if (previewType === "adult_reject") {
    const adultInvite = await getAdultInvite();
    const adultReject = await generateOpenWorldAdultReject({
      npcName: firstNpcDraft.name,
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dangerous_preference",
      atmosphereHint: adultInvite.atmosphere,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      adultReject,
    };
  }

  if (previewType === "adult_rumor") {
    const adultInvite = await getAdultInvite();
    const adultRumor = await generateOpenWorldAdultRumor({
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dangerous_preference",
      moodHint: adultInvite.atmosphere,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      adultRumor,
    };
  }

  if (previewType === "corruption_growth") {
    const adultAccept = await generateOpenWorldAdultAccept({
      npcName: firstNpcDraft.name,
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dual_cultivation",
      atmosphereHint: "心防被一寸寸撬开，余温仍在。",
    });
    const corruptionGrowth = await generateOpenWorldCorruptionGrowth({
      npcName: firstNpcDraft.name,
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dual_cultivation",
      corruptionValue: 58,
      atmosphereHint: adultAccept.atmosphere,
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      corruptionGrowth,
    };
  }

  if (previewType === "forced_consequence") {
    const forcedConsequence = await generateOpenWorldForcedConsequence({
      npcName: firstNpcDraft.name,
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dangerous_preference",
      atmosphereHint: "气机已经压得很近。",
      forcedAction: "forced_dual_cultivation",
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      forcedConsequence,
    };
  }

  if (previewType === "partner_jealousy") {
    const partnerJealousy = await generateOpenWorldPartnerJealousy({
      npcName: firstNpcDraft.name,
      partnerName: "旧道侣",
      mapName: mapDraft.name,
      districtName: firstDistrict,
      actionType: "dual_cultivation",
      atmosphereHint: "风声已经落到了不该听见的人耳中。",
    });
    return {
      generatedAt: new Date().toISOString(),
      previewType,
      partnerJealousy,
    };
  }

  const adultInvite = await getAdultInvite();
  const adultAccept = await generateOpenWorldAdultAccept({
    npcName: firstNpcDraft.name,
    mapName: mapDraft.name,
    districtName: firstDistrict,
    actionType: "dual_cultivation",
    atmosphereHint: adultInvite.atmosphere,
  });
  const adultResult = await generateOpenWorldAdultResult({
    npcName: firstNpcDraft.name,
    mapName: mapDraft.name,
    districtName: firstDistrict,
    actionType: "dual_cultivation",
    atmosphereHint: adultAccept.atmosphere,
  });
  return {
    generatedAt: new Date().toISOString(),
    previewType,
    adultResult,
  };
}

async function buildCompactPreviewBundle(seed: PreviewSeed) {
  const { mapDraft, npcDrafts, worldBookContext } = seed;
  const npcContext = await buildPreviewNpcContext(seed);
  const {
    npcDnaBatch,
    firstNpcDraft,
    firstNpcDna,
    firstDistrict,
  } = npcContext;

  const [mapMeta, bark, tiandaoEvent, factionTone] = await Promise.all([
    generateOpenWorldMapMeta(mapDraft),
    generateOpenWorldNpcBark({
      seed: `${mapDraft.seed}:preview:bark`,
      mapName: mapDraft.name,
      mapArchetype: mapDraft.archetype,
      currentDistrictName: firstDistrict,
      npcName: firstNpcDraft.name,
      profession: firstNpcDna?.profession || firstNpcDraft.profession,
      realmName: firstNpcDraft.realmName,
      personalitySummary: firstNpcDna?.personalitySummary || firstNpcDraft.personalitySummary,
      currentActionLabel: firstNpcDraft.runtime.currentActionLabel,
    }),
    generateOpenWorldTiandaoEvent({
      eventType: "preview",
      mapName: mapDraft.name,
      mapArchetype: mapDraft.archetype,
      actorName: firstNpcDraft.name,
      detail: `${firstNpcDraft.name}在 ${mapDraft.name} 附近留下了一段新的命数回响。`,
    }),
    generateOpenWorldFactionTone({
      factionName: firstNpcDna?.faction || firstNpcDraft.faction,
      categoryLabel: "灰线商会",
      districtName: firstDistrict,
      standingSummary: "这股势力更愿意接近有风声、有灰活、又不算彻底失控的人。",
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    worldBookContext,
    map: {
      mapId: mapDraft.id,
      mapName: mapDraft.name,
      archetype: mapDraft.archetype,
      source: mapMeta.source,
      description: mapMeta.description,
      theme: mapMeta.theme,
      districts: mapMeta.districts,
      buildingTags: mapMeta.buildingTags,
      resourceThemes: mapMeta.resourceThemes,
      npcCrowds: mapMeta.npcCrowds,
      rumorSeeds: mapMeta.rumorSeeds,
    },
    npcDnaBatch: {
      source: npcDnaBatch.source,
      profiles: npcDrafts.slice(0, 3).map((npcDraft) => ({
        npcId: npcDraft.id,
        name: npcDraft.name,
        realmName: npcDraft.realmName,
        profile: npcDnaBatch.profiles[npcDraft.id],
      })),
    },
    bark,
    tiandaoEvent,
    factionTone,
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const previewType = String(body?.previewType || "").trim() as PreviewType | "";
    if (previewType === "keyword_pool") {
      const seedKeywords = Array.isArray(body?.seedKeywords)
        ? body.seedKeywords.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const styleKeywords = Array.isArray(body?.styleKeywords)
        ? body.styleKeywords.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const forbiddenKeywords = Array.isArray(body?.forbiddenKeywords)
        ? body.forbiddenKeywords.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const data = await generateOpenWorldKeywordPool({
        seedKeywords,
        styleKeywords,
        forbiddenKeywords,
        worldTheme: String(body?.worldTheme || "").trim(),
      });
      return NextResponse.json({
        success: true,
        data: {
          generatedAt: new Date().toISOString(),
          previewType,
          ...data,
        },
      });
    }
    if (previewType === "custom_npc_library") {
      const seedKeywords = Array.isArray(body?.seedKeywords)
        ? body.seedKeywords.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const styleKeywords = Array.isArray(body?.styleKeywords)
        ? body.styleKeywords.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const forbiddenKeywords = Array.isArray(body?.forbiddenKeywords)
        ? body.forbiddenKeywords.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const preferredMapTags = Array.isArray(body?.preferredMapTags)
        ? body.preferredMapTags.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
        : [];
      const data = await generateOpenWorldCustomNpcLibrary({
        seedKeywords,
        styleKeywords,
        forbiddenKeywords,
        preferredMapTags,
        worldTheme: String(body?.worldTheme || "").trim(),
        npcCount: Number(body?.npcCount || 4),
      });
      return NextResponse.json({
        success: true,
        data: {
          generatedAt: new Date().toISOString(),
          previewType,
          ...data,
        },
      });
    }
    const seed = await buildPreviewSeed(previewType);
    if (previewType) {
      const data = await buildSinglePreview(seed);
      return NextResponse.json({
        success: true,
        data,
      });
    }

    const data = await buildCompactPreviewBundle(seed);
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "开放世界 AI 预览失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
