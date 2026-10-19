export const REALTIME_ENTITY_SCHEMA = "realtime_entity_v1";
export const REALTIME_ENTITY_SCHEMA_VERSION = 1;
export const MAP_SCENE_TUPLE_SCHEMA = "map_scene_tuple_v1";
export const BATTLE_SCENE_TUPLE_SCHEMA = "battle_scene_tuple_v1";

const BATTLE_SCENE_MODE_TO_CODE = {
  full: 0,
  delta: 1,
  repair: 2,
};

const BATTLE_SCENE_CODE_TO_MODE = {
  0: "full",
  1: "delta",
  2: "repair",
};

const MAP_ENTITY_KIND_TO_CODE = {
  self: 0,
  player: 1,
  npc: 2,
  monster: 3,
  opportunity: 4,
};

const MAP_ENTITY_CODE_TO_KIND = {
  0: "self",
  1: "player",
  2: "npc",
  3: "monster",
  4: "opportunity",
};

const BATTLE_ENTITY_ROLE_TO_CODE = {
  player: 0,
  enemy: 1,
  boss: 2,
};

const BATTLE_ENTITY_CODE_TO_ROLE = {
  0: "player",
  1: "enemy",
  2: "boss",
};

function createStringDictionary() {
  const strings = [];
  const lookup = new Map();

  const indexOf = (value) => {
    if (value === null || value === undefined) {
      return -1;
    }
    const key = String(value);
    if (lookup.has(key)) {
      return lookup.get(key);
    }
    const nextIndex = strings.length;
    strings.push(key);
    lookup.set(key, nextIndex);
    return nextIndex;
  };

  const resolve = (index) => {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= strings.length) {
      return null;
    }
    return strings[index] ?? null;
  };

  return {
    strings,
    indexOf,
    resolve,
  };
}

function normalizeInteger(value, fallback = 0) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return fallback;
  }
  return Math.trunc(nextValue);
}

function normalizeNumber(value, fallback = 0) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value;
}

function packMonsterDrops(drops, dictionary) {
  if (!Array.isArray(drops) || drops.length < 1) {
    return [];
  }
  return drops.map((drop) => ([
    dictionary.indexOf(drop?.itemId ?? null),
    dictionary.indexOf(drop?.itemName ?? null),
    dictionary.indexOf(drop?.itemIconUrl ?? null),
    dictionary.indexOf(drop?.itemRarity ?? null),
    normalizeNumber(drop?.chance, 0),
    normalizeInteger(drop?.minQuantity, 0),
    normalizeInteger(drop?.maxQuantity, 0),
  ]));
}

function unpackMonsterDrops(tuples, dictionary) {
  if (!Array.isArray(tuples) || tuples.length < 1) {
    return [];
  }
  return tuples.map((tuple) => ({
    itemId: dictionary.resolve(tuple?.[0]) || "",
    itemName: dictionary.resolve(tuple?.[1]) || "",
    itemIconUrl: dictionary.resolve(tuple?.[2]),
    itemRarity: dictionary.resolve(tuple?.[3]),
    chance: normalizeNumber(tuple?.[4], 0),
    minQuantity: normalizeInteger(tuple?.[5], 0),
    maxQuantity: normalizeInteger(tuple?.[6], 0),
  }));
}

function packMonsterDropIntel(dropIntel, dictionary) {
  if (!Array.isArray(dropIntel) || dropIntel.length < 1) {
    return [];
  }
  return dropIntel.map((item) => ([
    dictionary.indexOf(item?.label ?? null),
    dictionary.indexOf(item?.rarity ?? null),
    dictionary.indexOf(item?.rarityLabel ?? null),
    dictionary.indexOf(item?.chanceText ?? null),
    dictionary.indexOf(item?.quantityText ?? null),
  ]));
}

function unpackMonsterDropIntel(tuples, dictionary) {
  if (!Array.isArray(tuples) || tuples.length < 1) {
    return [];
  }
  return tuples.map((tuple) => ({
    label: dictionary.resolve(tuple?.[0]) || "",
    rarity: dictionary.resolve(tuple?.[1]) || "common",
    rarityLabel: dictionary.resolve(tuple?.[2]) || "",
    chanceText: dictionary.resolve(tuple?.[3]) || "",
    quantityText: dictionary.resolve(tuple?.[4]) || "",
  }));
}

function packMapSceneEntityTuple(entity, dictionary) {
  const kindCode = MAP_ENTITY_KIND_TO_CODE[entity?.entityType] ?? MAP_ENTITY_KIND_TO_CODE.player;

  if (entity?.entityType === "self" || entity?.entityType === "player") {
    return [
      kindCode,
      dictionary.indexOf(entity?.id ?? null),
      dictionary.indexOf(entity?.name ?? null),
      dictionary.indexOf(entity?.gender ?? null),
      dictionary.indexOf(entity?.avatarImageUrl ?? null),
      dictionary.indexOf(entity?.avatarFrameImageUrl ?? null),
      normalizeInteger(entity?.realm, 0),
      entity?.realmMajor === null || entity?.realmMajor === undefined ? null : normalizeInteger(entity?.realmMajor, 0),
      entity?.realmMinor === null || entity?.realmMinor === undefined ? null : normalizeInteger(entity?.realmMinor, 0),
      dictionary.indexOf(entity?.realmName ?? null),
      normalizeNumber(entity?.positionX, 0),
      normalizeNumber(entity?.positionY, 0),
      normalizeNumber(entity?.velocityXPerSecond, 0),
      normalizeNumber(entity?.velocityYPerSecond, 0),
    ];
  }

  if (entity?.entityType === "npc") {
    return [
      kindCode,
      dictionary.indexOf(entity?.id ?? null),
      dictionary.indexOf(entity?.name ?? null),
      dictionary.indexOf(entity?.title ?? null),
      dictionary.indexOf(entity?.avatarImageUrl ?? null),
      normalizeNumber(entity?.positionX, 0),
      normalizeNumber(entity?.positionY, 0),
      entity?.isShop ? 1 : 0,
      dictionary.indexOf(entity?.sourceType ?? null),
      dictionary.indexOf(entity?.detailRoute ?? null),
      dictionary.indexOf(entity?.realmName ?? null),
      dictionary.indexOf(entity?.currentActionLabel ?? null),
      entity?.isKillable ? 1 : 0,
      dictionary.indexOf(entity?.status ?? null),
      normalizeNumber(entity?.velocityXPerSecond, 0),
      normalizeNumber(entity?.velocityYPerSecond, 0),
    ];
  }

  if (entity?.entityType === "monster") {
    return [
      kindCode,
      dictionary.indexOf(entity?.id ?? null),
      dictionary.indexOf(entity?.name ?? null),
      dictionary.indexOf(entity?.avatarImageUrl ?? null),
      dictionary.indexOf(entity?.monsterType ?? null),
      normalizeInteger(entity?.level, 0),
      normalizeInteger(entity?.hp, 0),
      normalizeInteger(entity?.attack, 0),
      normalizeInteger(entity?.defense, 0),
      normalizeInteger(entity?.speed, 0),
      normalizeNumber(entity?.positionX, 0),
      normalizeNumber(entity?.positionY, 0),
      normalizeNumber(entity?.velocityXPerSecond, 0),
      normalizeNumber(entity?.velocityYPerSecond, 0),
      packMonsterDrops(entity?.drops, dictionary),
      packMonsterDropIntel(entity?.dropIntel, dictionary),
    ];
  }

  return [
    kindCode,
    dictionary.indexOf(entity?.spawnId ?? entity?.id ?? null),
    dictionary.indexOf(entity?.eventId ?? null),
    dictionary.indexOf(entity?.name ?? null),
    dictionary.indexOf(entity?.iconImageUrl ?? null),
    normalizeInteger(entity?.minRealm, 0),
    entity?.maxRealm === null || entity?.maxRealm === undefined ? null : normalizeInteger(entity?.maxRealm, 0),
    normalizeNumber(entity?.positionX, 0),
    normalizeNumber(entity?.positionY, 0),
    dictionary.indexOf(entity?.expiresAt ?? null),
    normalizeNumber(entity?.velocityXPerSecond, 0),
    normalizeNumber(entity?.velocityYPerSecond, 0),
  ];
}

function unpackMapSceneEntityTuple(tuple, dictionary, mapId) {
  const entityKind = MAP_ENTITY_CODE_TO_KIND[normalizeInteger(tuple?.[0], 1)] || "player";

  if (entityKind === "self" || entityKind === "player") {
    return {
      entityType: entityKind,
      id: dictionary.resolve(tuple?.[1]) || "",
      name: dictionary.resolve(tuple?.[2]) || "",
      gender: dictionary.resolve(tuple?.[3]),
      avatarImageUrl: dictionary.resolve(tuple?.[4]),
      avatarFrameImageUrl: dictionary.resolve(tuple?.[5]),
      realm: normalizeInteger(tuple?.[6], 0),
      realmMajor: tuple?.[7] === null || tuple?.[7] === undefined ? null : normalizeInteger(tuple?.[7], 0),
      realmMinor: tuple?.[8] === null || tuple?.[8] === undefined ? null : normalizeInteger(tuple?.[8], 0),
      realmName: dictionary.resolve(tuple?.[9]),
      positionX: normalizeNumber(tuple?.[10], 0),
      positionY: normalizeNumber(tuple?.[11], 0),
      velocityXPerSecond: normalizeNumber(tuple?.[12], 0),
      velocityYPerSecond: normalizeNumber(tuple?.[13], 0),
      mapId,
    };
  }

  if (entityKind === "npc") {
    return {
      entityType: "npc",
      id: dictionary.resolve(tuple?.[1]) || "",
      name: dictionary.resolve(tuple?.[2]) || "",
      title: dictionary.resolve(tuple?.[3]),
      avatarImageUrl: dictionary.resolve(tuple?.[4]),
      positionX: normalizeNumber(tuple?.[5], 0),
      positionY: normalizeNumber(tuple?.[6], 0),
      isShop: normalizeInteger(tuple?.[7], 0) === 1,
      sourceType: dictionary.resolve(tuple?.[8]),
      detailRoute: dictionary.resolve(tuple?.[9]),
      realmName: dictionary.resolve(tuple?.[10]),
      currentActionLabel: dictionary.resolve(tuple?.[11]),
      isKillable: normalizeInteger(tuple?.[12], 0) === 1,
      status: dictionary.resolve(tuple?.[13]),
      velocityXPerSecond: normalizeNumber(tuple?.[14], 0),
      velocityYPerSecond: normalizeNumber(tuple?.[15], 0),
      mapId,
    };
  }

  if (entityKind === "monster") {
    return {
      entityType: "monster",
      id: dictionary.resolve(tuple?.[1]) || "",
      name: dictionary.resolve(tuple?.[2]) || "",
      avatarImageUrl: dictionary.resolve(tuple?.[3]),
      monsterType: dictionary.resolve(tuple?.[4]) || "",
      level: normalizeInteger(tuple?.[5], 0),
      hp: normalizeInteger(tuple?.[6], 0),
      attack: normalizeInteger(tuple?.[7], 0),
      defense: normalizeInteger(tuple?.[8], 0),
      speed: normalizeInteger(tuple?.[9], 0),
      positionX: normalizeNumber(tuple?.[10], 0),
      positionY: normalizeNumber(tuple?.[11], 0),
      velocityXPerSecond: normalizeNumber(tuple?.[12], 0),
      velocityYPerSecond: normalizeNumber(tuple?.[13], 0),
      drops: unpackMonsterDrops(tuple?.[14], dictionary),
      dropIntel: unpackMonsterDropIntel(tuple?.[15], dictionary),
      mapId,
    };
  }

  const spawnId = dictionary.resolve(tuple?.[1]) || "";
  return {
    entityType: "opportunity",
    id: spawnId,
    spawnId,
    eventId: dictionary.resolve(tuple?.[2]) || "",
    name: dictionary.resolve(tuple?.[3]) || "",
    iconImageUrl: dictionary.resolve(tuple?.[4]),
    minRealm: normalizeInteger(tuple?.[5], 0),
    maxRealm: tuple?.[6] === null || tuple?.[6] === undefined ? null : normalizeInteger(tuple?.[6], 0),
    positionX: normalizeNumber(tuple?.[7], 0),
    positionY: normalizeNumber(tuple?.[8], 0),
    expiresAt: dictionary.resolve(tuple?.[9]) || "",
    velocityXPerSecond: normalizeNumber(tuple?.[10], 0),
    velocityYPerSecond: normalizeNumber(tuple?.[11], 0),
    mapId,
  };
}

export function packMapSceneSnapshotForWire(snapshot) {
  const dictionary = createStringDictionary();
  return {
    codecSchema: MAP_SCENE_TUPLE_SCHEMA,
    entitySchema: snapshot?.entitySchema || REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: normalizeInteger(snapshot?.entitySchemaVersion, REALTIME_ENTITY_SCHEMA_VERSION),
    runtimeVersion: normalizeInteger(snapshot?.runtimeVersion, 0),
    sequence: normalizeInteger(snapshot?.sequence, 0),
    connectionSequence: normalizeInteger(snapshot?.connectionSequence ?? snapshot?.sequence, 0),
    tick: normalizeInteger(snapshot?.tick, 0),
    sceneVersion: normalizeInteger(snapshot?.sceneVersion, 0),
    entitiesRevision: normalizeInteger(snapshot?.entitiesRevision, 0),
    serverTimeMs: normalizeInteger(snapshot?.serverTimeMs, 0),
    mapId: dictionary.indexOf(snapshot?.mapId ?? null),
    mode: dictionary.indexOf(snapshot?.mode ?? "full"),
    baseSequence: typeof snapshot?.baseSequence === "number" ? normalizeInteger(snapshot.baseSequence, 0) : null,
    baseConnectionSequence: typeof snapshot?.baseConnectionSequence === "number"
      ? normalizeInteger(snapshot.baseConnectionSequence, 0)
      : null,
    subscribedSectorKeys: Array.isArray(snapshot?.subscribedSectorKeys)
      ? snapshot.subscribedSectorKeys.map((key) => dictionary.indexOf(key))
      : [],
    removedEntityIds: Array.isArray(snapshot?.removedEntityIds)
      ? snapshot.removedEntityIds.map((id) => dictionary.indexOf(id))
      : [],
    dict: dictionary.strings,
    entities: Array.isArray(snapshot?.entities)
      ? snapshot.entities.map((entity) => packMapSceneEntityTuple(entity, dictionary))
      : [],
  };
}

export function unpackMapSceneSnapshotFromWire(encodedSnapshot) {
  const dict = Array.isArray(encodedSnapshot?.dict) ? encodedSnapshot.dict.map((value) => String(value)) : [];
  const dictionary = {
    resolve(index) {
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= dict.length) {
        return null;
      }
      return dict[index] ?? null;
    },
  };
  const mapId = dictionary.resolve(encodedSnapshot?.mapId) || "";

  return {
    entitySchema: dictionary.resolve(encodedSnapshot?.entitySchema) || encodedSnapshot?.entitySchema || REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: normalizeInteger(encodedSnapshot?.entitySchemaVersion, REALTIME_ENTITY_SCHEMA_VERSION),
    runtimeVersion: normalizeInteger(encodedSnapshot?.runtimeVersion, 0),
    sequence: normalizeInteger(encodedSnapshot?.sequence, 0),
    connectionSequence: normalizeInteger(encodedSnapshot?.connectionSequence ?? encodedSnapshot?.sequence, 0),
    tick: normalizeInteger(encodedSnapshot?.tick, 0),
    sceneVersion: normalizeInteger(encodedSnapshot?.sceneVersion, 0),
    entitiesRevision: normalizeInteger(encodedSnapshot?.entitiesRevision, 0),
    serverTimeMs: normalizeInteger(encodedSnapshot?.serverTimeMs, 0),
    mapId,
    mode: dictionary.resolve(encodedSnapshot?.mode) || "full",
    baseSequence: typeof encodedSnapshot?.baseSequence === "number"
      ? normalizeInteger(encodedSnapshot.baseSequence, 0)
      : undefined,
    baseConnectionSequence: typeof encodedSnapshot?.baseConnectionSequence === "number"
      ? normalizeInteger(encodedSnapshot.baseConnectionSequence, 0)
      : undefined,
    subscribedSectorKeys: Array.isArray(encodedSnapshot?.subscribedSectorKeys)
      ? encodedSnapshot.subscribedSectorKeys
        .map((value) => dictionary.resolve(value))
        .filter(Boolean)
      : [],
    removedEntityIds: Array.isArray(encodedSnapshot?.removedEntityIds)
      ? encodedSnapshot.removedEntityIds
        .map((value) => dictionary.resolve(value))
        .filter(Boolean)
      : [],
    entities: Array.isArray(encodedSnapshot?.entities)
      ? encodedSnapshot.entities.map((tuple) => unpackMapSceneEntityTuple(tuple, dictionary, mapId))
      : [],
  };
}

export function normalizeBattleSceneUnitForSchema(unit) {
  return {
    entitySchema: REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: REALTIME_ENTITY_SCHEMA_VERSION,
    codecSchema: BATTLE_SCENE_TUPLE_SCHEMA,
    id: String(unit?.id || ""),
    role: String(unit?.role || "player"),
    slot: unit?.slot === null || unit?.slot === undefined ? null : normalizeInteger(unit.slot, 0),
    name: unit?.name ? String(unit.name) : "",
    avatarImageUrl: unit?.avatarImageUrl ? String(unit.avatarImageUrl) : null,
    avatarFrameImageUrl: unit?.avatarFrameImageUrl ? String(unit.avatarFrameImageUrl) : null,
    isCurrent: Boolean(unit?.isCurrent),
  };
}

function packBattleSceneUnitTuple(unit, dictionary) {
  const normalizedUnit = normalizeBattleSceneUnitForSchema(unit);
  return [
    dictionary.indexOf(normalizedUnit.id),
    BATTLE_ENTITY_ROLE_TO_CODE[normalizedUnit.role] ?? 0,
    normalizedUnit.slot,
    dictionary.indexOf(normalizedUnit.name),
    dictionary.indexOf(normalizedUnit.avatarImageUrl),
    dictionary.indexOf(normalizedUnit.avatarFrameImageUrl),
    normalizedUnit.isCurrent ? 1 : 0,
    normalizeNumber(unit?.xPercent, 0),
    normalizeNumber(unit?.yPercent, 0),
    normalizeNumber(unit?.velocityXPercentPerSecond, 0),
    normalizeNumber(unit?.velocityYPercentPerSecond, 0),
  ];
}

function unpackBattleSceneUnitTuple(tuple, dictionary) {
  return {
    id: dictionary.resolve(tuple?.[0]) || "",
    role: BATTLE_ENTITY_CODE_TO_ROLE[normalizeInteger(tuple?.[1], 0)] || "player",
    slot: tuple?.[2] === null || tuple?.[2] === undefined ? null : normalizeInteger(tuple?.[2], 0),
    name: dictionary.resolve(tuple?.[3]) || undefined,
    avatarImageUrl: dictionary.resolve(tuple?.[4]),
    avatarFrameImageUrl: dictionary.resolve(tuple?.[5]),
    isCurrent: normalizeInteger(tuple?.[6], 0) === 1,
    xPercent: normalizeNumber(tuple?.[7], 0),
    yPercent: normalizeNumber(tuple?.[8], 0),
    velocityXPercentPerSecond: normalizeNumber(tuple?.[9], 0),
    velocityYPercentPerSecond: normalizeNumber(tuple?.[10], 0),
  };
}

function packBattleSceneTimelineEventTuple(event, dictionary) {
  return [
    dictionary.indexOf(event?.id ?? null),
    dictionary.indexOf(event?.actorId ?? null),
    dictionary.indexOf(event?.targetId ?? null),
    normalizeInteger(event?.startedAtMs, 0),
    normalizeInteger(event?.windupMs, 0),
    normalizeInteger(event?.activeMs, 0),
    normalizeInteger(event?.recoverMs, 0),
    normalizeNumber(event?.actorAdvancePercent, 0),
    normalizeNumber(event?.targetRecoilPercent, 0),
  ];
}

function unpackBattleSceneTimelineEventTuple(tuple, dictionary) {
  return {
    id: dictionary.resolve(tuple?.[0]) || "",
    actorId: dictionary.resolve(tuple?.[1]) || "",
    targetId: dictionary.resolve(tuple?.[2]),
    startedAtMs: normalizeInteger(tuple?.[3], 0),
    windupMs: normalizeInteger(tuple?.[4], 0),
    activeMs: normalizeInteger(tuple?.[5], 0),
    recoverMs: normalizeInteger(tuple?.[6], 0),
    actorAdvancePercent: normalizeNumber(tuple?.[7], 0),
    targetRecoilPercent: normalizeNumber(tuple?.[8], 0),
  };
}

export function packBattleSceneSnapshotForWire(snapshot) {
  const dictionary = createStringDictionary();
  return {
    codecSchema: BATTLE_SCENE_TUPLE_SCHEMA,
    entitySchema: snapshot?.entitySchema || REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: normalizeInteger(snapshot?.entitySchemaVersion, REALTIME_ENTITY_SCHEMA_VERSION),
    runtimeVersion: normalizeInteger(snapshot?.runtimeVersion, 0),
    sceneVersion: normalizeInteger(snapshot?.sceneVersion, 0),
    sequence: normalizeInteger(snapshot?.sequence, 0),
    connectionSequence: normalizeInteger(snapshot?.connectionSequence ?? snapshot?.sequence, 0),
    baseConnectionSequence: typeof snapshot?.baseConnectionSequence === "number"
      ? normalizeInteger(snapshot.baseConnectionSequence, 0)
      : null,
    tick: normalizeInteger(snapshot?.tick, 0),
    entitiesRevision: normalizeInteger(snapshot?.entitiesRevision, 0),
    serverTimeMs: normalizeInteger(snapshot?.serverTimeMs, 0),
    mode: BATTLE_SCENE_MODE_TO_CODE[snapshot?.mode] ?? 0,
    removedUnitIds: Array.isArray(snapshot?.removedUnitIds)
      ? snapshot.removedUnitIds.map((id) => dictionary.indexOf(id))
      : [],
    dict: dictionary.strings,
    units: Array.isArray(snapshot?.units)
      ? snapshot.units.map((unit) => packBattleSceneUnitTuple(unit, dictionary))
      : [],
    timeline: Array.isArray(snapshot?.timeline)
      ? snapshot.timeline.map((event) => packBattleSceneTimelineEventTuple(event, dictionary))
      : [],
  };
}

export function unpackBattleSceneSnapshotFromWire(encodedSnapshot) {
  const dict = Array.isArray(encodedSnapshot?.dict) ? encodedSnapshot.dict.map((value) => String(value)) : [];
  const dictionary = {
    resolve(index) {
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= dict.length) {
        return null;
      }
      return dict[index] ?? null;
    },
  };

  return {
    entitySchema: normalizeString(encodedSnapshot?.entitySchema, REALTIME_ENTITY_SCHEMA),
    entitySchemaVersion: normalizeInteger(encodedSnapshot?.entitySchemaVersion, REALTIME_ENTITY_SCHEMA_VERSION),
    runtimeVersion: normalizeInteger(encodedSnapshot?.runtimeVersion, 0),
    sceneVersion: normalizeInteger(encodedSnapshot?.sceneVersion, 0),
    sequence: normalizeInteger(encodedSnapshot?.sequence, 0),
    connectionSequence: normalizeInteger(encodedSnapshot?.connectionSequence ?? encodedSnapshot?.sequence, 0),
    baseConnectionSequence: typeof encodedSnapshot?.baseConnectionSequence === "number"
      ? normalizeInteger(encodedSnapshot.baseConnectionSequence, 0)
      : undefined,
    tick: normalizeInteger(encodedSnapshot?.tick, 0),
    entitiesRevision: normalizeInteger(encodedSnapshot?.entitiesRevision, 0),
    serverTimeMs: normalizeInteger(encodedSnapshot?.serverTimeMs, 0),
    mode: BATTLE_SCENE_CODE_TO_MODE[normalizeInteger(encodedSnapshot?.mode, 0)] || "full",
    removedUnitIds: Array.isArray(encodedSnapshot?.removedUnitIds)
      ? encodedSnapshot.removedUnitIds
        .map((value) => dictionary.resolve(value))
        .filter(Boolean)
      : [],
    units: Array.isArray(encodedSnapshot?.units)
      ? encodedSnapshot.units.map((tuple) => unpackBattleSceneUnitTuple(tuple, dictionary))
      : [],
    timeline: Array.isArray(encodedSnapshot?.timeline)
      ? encodedSnapshot.timeline.map((tuple) => unpackBattleSceneTimelineEventTuple(tuple, dictionary))
      : [],
  };
}

export function packBattleSceneUnitsForSchema(units) {
  const dictionary = createStringDictionary();
  return {
    codecSchema: BATTLE_SCENE_TUPLE_SCHEMA,
    entitySchema: REALTIME_ENTITY_SCHEMA,
    entitySchemaVersion: REALTIME_ENTITY_SCHEMA_VERSION,
    dict: dictionary.strings,
    entities: Array.isArray(units)
      ? units.map((unit) => packBattleSceneUnitTuple(unit, dictionary).slice(0, 7))
      : [],
  };
}

export function unpackBattleSceneUnitsFromSchema(encodedUnits) {
  const dict = Array.isArray(encodedUnits?.dict) ? encodedUnits.dict.map((value) => String(value)) : [];
  const resolve = (index) => (
    typeof index === "number" && Number.isInteger(index) && index >= 0 && index < dict.length
      ? (dict[index] ?? null)
      : null
  );

  if (!Array.isArray(encodedUnits?.entities)) {
    return [];
  }

  return encodedUnits.entities.map((tuple) => ({
    ...unpackBattleSceneUnitTuple(tuple, { resolve }),
  }));
}
