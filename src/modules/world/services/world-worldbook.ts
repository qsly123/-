import { getSystemConfigValue } from "@/modules/system/services/system-config";

export type OpenWorldWorldBookScene =
  | "map_meta"
  | "npc_dna"
  | "keyword_pool"
  | "npc_bark"
  | "tiandao_event"
  | "district_rumor"
  | "faction_tone"
  | "district_state"
  | "storyline"
  | "npc_faction_hint"
  | "shadow_event"
  | "pressure_relief"
  | "custom_npc"
  | "adult_profile"
  | "adult_invite"
  | "adult_accept"
  | "adult_reject"
  | "adult_result"
  | "adult_drain"
  | "adult_pregnancy"
  | "adult_rumor"
  | "adult_bark"
  | "corruption_growth"
  | "forced_consequence"
  | "partner_jealousy";

type RawWorldBookEntry = Record<string, unknown>;

export type OpenWorldWorldBookEntry = {
  id: string;
  comment: string;
  content: string;
  keys: string[];
  secondaryKeys: string[];
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  position: "before" | "after";
  priority: number;
  probability: number;
  useProbability: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
};

export type OpenWorldWorldBook = {
  name: string;
  enabled: boolean;
  entries: OpenWorldWorldBookEntry[];
};

export type OpenWorldWorldBookMatch = {
  id: string;
  comment: string;
  reason: "constant" | "keyword";
  matchedKeywords: string[];
  position: "before" | "after";
  priority: number;
  content: string;
};

export type OpenWorldWorldBookContextResult = {
  source: "disabled" | "empty" | "configured";
  bookName: string;
  matchedEntries: OpenWorldWorldBookMatch[];
  beforeText: string;
  afterText: string;
  contextText: string;
};

const OPEN_WORLD_WORLDBOOK_ENABLED_KEY = "OPEN_WORLD_WORLDBOOK_ENABLED";
const OPEN_WORLD_WORLDBOOK_JSON_KEY = "OPEN_WORLD_WORLDBOOK_JSON";
const OPEN_WORLD_WORLDBOOK_MAX_MATCHES = 12;
const OPEN_WORLD_WORLDBOOK_MAX_TEXT_LENGTH = 6_000;
const OPEN_WORLD_WORLDBOOK_CACHE_TTL_MS = 15_000;

type OpenWorldWorldBookGlobalStore = typeof globalThis & {
  __immortalityOpenWorldWorldBookCache?: {
    expiresAt: number;
    enabledValue: string | null;
    jsonValue: string | null;
    book: OpenWorldWorldBook;
  };
  __immortalityOpenWorldWorldBookPromise?: Promise<OpenWorldWorldBook>;
};

function trimText(value: unknown, maxLength: number, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().replace(/\r\n/g, "\n");
  return normalized.slice(0, maxLength) || fallback;
}

function normalizeKeywordArray(value: unknown, maxCount: number) {
  if (typeof value === "string") {
    const single = trimText(value, 80);
    return single ? [single] : [] as string[];
  }

  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => trimText(entry, 80))
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, maxCount);
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePosition(value: unknown, fallback: "before" | "after") {
  if (value === "before_char" || value === "before") {
    return "before";
  }
  if (value === "after_char" || value === "after") {
    return "after";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric <= 0 ? "before" : "after";
  }
  return fallback;
}

function normalizeEntry(rawEntry: RawWorldBookEntry, fallbackId: string, index: number): OpenWorldWorldBookEntry | null {
  const content = trimText(rawEntry.content, 4_000);
  if (!content) {
    return null;
  }

  const extensions = (rawEntry.extensions && typeof rawEntry.extensions === "object" && !Array.isArray(rawEntry.extensions))
    ? rawEntry.extensions as Record<string, unknown>
    : {};
  const enabled = !normalizeBoolean(rawEntry.disable, false) && normalizeBoolean(rawEntry.enabled, true);
  const keys = normalizeKeywordArray(rawEntry.key ?? rawEntry.keys, 24);
  const secondaryKeys = normalizeKeywordArray(
    rawEntry.keysecondary
      ?? rawEntry.secondary_keys
      ?? rawEntry.secondaryKeys,
    24,
  );
  const constant = normalizeBoolean(rawEntry.constant, keys.length <= 0 && secondaryKeys.length <= 0);
  const selective = normalizeBoolean(rawEntry.selective, keys.length > 0 || secondaryKeys.length > 0);
  const position = normalizePosition(
    rawEntry.position ?? extensions.position,
    normalizeNumber(rawEntry.insertion_order, 0) <= 1 ? "before" : "after",
  );
  const comment = trimText(rawEntry.comment, 80, `世界书条目 ${index + 1}`);
  const probability = Math.max(0, Math.min(100, normalizeNumber(rawEntry.probability, 100)));
  const useProbability = normalizeBoolean(rawEntry.useProbability, probability < 100);
  const caseSensitive = normalizeBoolean(rawEntry.caseSensitive ?? extensions.case_sensitive, false);
  const matchWholeWords = normalizeBoolean(rawEntry.matchWholeWords ?? extensions.match_whole_words, false);
  const priority = normalizeNumber(
    rawEntry.order ?? rawEntry.insertion_order ?? rawEntry.displayIndex ?? rawEntry.uid,
    index + 1,
  );

  return {
    id: trimText(rawEntry.id ?? rawEntry.uid, 80, fallbackId),
    comment,
    content,
    keys,
    secondaryKeys,
    enabled,
    constant,
    selective,
    position,
    priority,
    probability,
    useProbability,
    caseSensitive,
    matchWholeWords,
  };
}

function parseWorldBookJson(rawText: string): OpenWorldWorldBook {
  const normalizedText = String(rawText || "").trim();
  if (!normalizedText) {
    return {
      name: "未配置世界书",
      enabled: false,
      entries: [],
    };
  }

  try {
    const parsed = JSON.parse(normalizedText) as {
      name?: unknown;
      entries?: Record<string, RawWorldBookEntry> | RawWorldBookEntry[];
      enabled?: unknown;
    };
    const rawEntries = Array.isArray(parsed.entries)
      ? parsed.entries
      : Object.entries(parsed.entries || {}).map(([id, entry]) => ({
        id,
        ...(entry || {}),
      }));
    const entries = rawEntries
      .map((entry, index) => normalizeEntry(entry, `worldbook:${index + 1}`, index))
      .filter((entry): entry is OpenWorldWorldBookEntry => Boolean(entry))
      .sort((left, right) => left.priority - right.priority);

    return {
      name: trimText(parsed.name, 120, "开放世界世界书"),
      enabled: normalizeBoolean(parsed.enabled, true),
      entries,
    };
  } catch {
    return {
      name: "世界书解析失败",
      enabled: false,
      entries: [],
    };
  }
}

function buildSearchableText(scene: OpenWorldWorldBookScene, payload: Record<string, unknown>) {
  return `${scene}\n${JSON.stringify(payload, null, 2)}`.toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(params: {
  sourceText: string;
  keyword: string;
  caseSensitive: boolean;
  matchWholeWords: boolean;
}) {
  const keyword = params.caseSensitive ? params.keyword : params.keyword.toLowerCase();
  if (!keyword) {
    return false;
  }

  if (!params.matchWholeWords) {
    return params.sourceText.includes(keyword);
  }

  const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(keyword)}([^\\p{L}\\p{N}_]|$)`, params.caseSensitive ? "u" : "iu");
  return expression.test(params.sourceText);
}

function trimWorldBookContent(content: string) {
  return content.trim().slice(0, 1_200);
}

function allowEntryByProbability(entry: OpenWorldWorldBookEntry, searchableText: string) {
  if (!entry.useProbability || entry.probability >= 100) {
    return true;
  }
  let hash = 0;
  const seed = `${entry.id}:${searchableText.slice(0, 300)}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash % 100) < entry.probability;
}

function selectWorldBookEntries(params: {
  book: OpenWorldWorldBook;
  scene: OpenWorldWorldBookScene;
  payload: Record<string, unknown>;
}) {
  const searchableText = buildSearchableText(params.scene, params.payload);
  const matches: OpenWorldWorldBookMatch[] = [];

  for (const entry of params.book.entries) {
    if (!entry.enabled) {
      continue;
    }
    if (!allowEntryByProbability(entry, searchableText)) {
      continue;
    }

    if (entry.constant) {
      matches.push({
        id: entry.id,
        comment: entry.comment,
        reason: "constant",
        matchedKeywords: [],
        position: entry.position,
        priority: entry.priority,
        content: trimWorldBookContent(entry.content),
      });
      continue;
    }

    if (!entry.selective) {
      continue;
    }

    const keywords = [...entry.keys, ...entry.secondaryKeys];
    const matchedKeywords = keywords.filter((keyword, index, list) => {
      if (list.indexOf(keyword) !== index) {
        return false;
      }
      return containsKeyword({
        sourceText: searchableText,
        keyword,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
      });
    });

    if (matchedKeywords.length <= 0) {
      continue;
    }

    matches.push({
      id: entry.id,
      comment: entry.comment,
      reason: "keyword",
      matchedKeywords,
      position: entry.position,
      priority: entry.priority,
      content: trimWorldBookContent(entry.content),
    });
  }

  return matches
    .sort((left, right) => {
      if (left.position !== right.position) {
        return left.position === "before" ? -1 : 1;
      }
      if (left.reason !== right.reason) {
        return left.reason === "constant" ? -1 : 1;
      }
      return left.priority - right.priority;
    })
    .slice(0, OPEN_WORLD_WORLDBOOK_MAX_MATCHES);
}

function buildContextText(bookName: string, entries: OpenWorldWorldBookMatch[]) {
  if (entries.length <= 0) {
    return "";
  }

  const sections: string[] = [`# 开放世界世界书：${bookName}`];
  for (const entry of entries) {
    const matchLine = entry.reason === "constant"
      ? "命中方式：常驻条目"
      : `命中方式：关键词 -> ${entry.matchedKeywords.join(" / ")}`;
    sections.push(`## ${entry.comment}`);
    sections.push(matchLine);
    sections.push(entry.content);
  }

  return sections.join("\n\n").slice(0, OPEN_WORLD_WORLDBOOK_MAX_TEXT_LENGTH);
}

async function loadWorldBookConfig() {
  const globalStore = globalThis as OpenWorldWorldBookGlobalStore;
  const cached = globalStore.__immortalityOpenWorldWorldBookCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.book;
  }
  if (globalStore.__immortalityOpenWorldWorldBookPromise) {
    return globalStore.__immortalityOpenWorldWorldBookPromise;
  }

  globalStore.__immortalityOpenWorldWorldBookPromise = (async () => {
    const [enabledValue, jsonValue] = await Promise.all([
      getSystemConfigValue(OPEN_WORLD_WORLDBOOK_ENABLED_KEY),
      getSystemConfigValue(OPEN_WORLD_WORLDBOOK_JSON_KEY),
    ]);

    const normalizedEnabledValue = typeof enabledValue === "string" ? enabledValue : null;
    const normalizedJsonValue = typeof jsonValue === "string" ? jsonValue : null;
    const currentCache = globalStore.__immortalityOpenWorldWorldBookCache;
    if (
      currentCache
      && currentCache.enabledValue === normalizedEnabledValue
      && currentCache.jsonValue === normalizedJsonValue
    ) {
      currentCache.expiresAt = Date.now() + OPEN_WORLD_WORLDBOOK_CACHE_TTL_MS;
      return currentCache.book;
    }

    const enabled = normalizeBoolean(enabledValue, false);
    const parsedBook = parseWorldBookJson(String(jsonValue || ""));
    const book = (!enabled || !parsedBook.enabled || parsedBook.entries.length <= 0)
      ? {
        ...parsedBook,
        enabled: false,
        entries: parsedBook.entries,
      }
      : {
        ...parsedBook,
        enabled: true,
      };

    globalStore.__immortalityOpenWorldWorldBookCache = {
      expiresAt: Date.now() + OPEN_WORLD_WORLDBOOK_CACHE_TTL_MS,
      enabledValue: normalizedEnabledValue,
      jsonValue: normalizedJsonValue,
      book,
    };
    return book;
  })().finally(() => {
    globalStore.__immortalityOpenWorldWorldBookPromise = undefined;
  });

  return globalStore.__immortalityOpenWorldWorldBookPromise;
}

export async function buildOpenWorldWorldBookContext(params: {
  scene: OpenWorldWorldBookScene;
  payload: Record<string, unknown>;
}): Promise<OpenWorldWorldBookContextResult> {
  const book = await loadWorldBookConfig();
  if (!book.enabled) {
    return {
      source: book.entries.length > 0 ? "disabled" : "empty",
      bookName: book.name,
      matchedEntries: [],
      beforeText: "",
      afterText: "",
      contextText: "",
    };
  }

  const matchedEntries = selectWorldBookEntries({
    book,
    scene: params.scene,
    payload: params.payload,
  });
  if (matchedEntries.length <= 0) {
    return {
      source: "configured",
      bookName: book.name,
      matchedEntries: [],
      beforeText: "",
      afterText: "",
      contextText: "",
    };
  }

  const beforeEntries = matchedEntries.filter((entry) => entry.position === "before");
  const afterEntries = matchedEntries.filter((entry) => entry.position === "after");
  const beforeText = buildContextText(book.name, beforeEntries);
  const afterText = buildContextText(book.name, afterEntries);

  return {
    source: "configured",
    bookName: book.name,
    matchedEntries,
    beforeText,
    afterText,
    contextText: [beforeText, afterText].filter(Boolean).join("\n\n"),
  };
}
