import { nanoid } from "nanoid";
import type {
  AttributeDelta,
  FortuneEventEffects,
  FortuneSpecialEffects,
  SpiritualRoot,
} from "@/types/game";

interface StarterFortuneOption {
  id: string;
  name: string;
  description: string | null;
  grade: string;
  durationSeconds: number;
  attrEffects: AttributeDelta;
  eventEffects: FortuneEventEffects;
  specialEffects: FortuneSpecialEffects;
}

interface CharacterCreatePreviewSession {
  accountId: string;
  gender: "男" | "女";
  spiritualRoot: SpiritualRoot;
  starterOptions: StarterFortuneOption[];
  createdAt: number;
  expiresAt: number;
}

type PreviewStoreGlobal = typeof globalThis & {
  __characterCreatePreviewStore?: Map<string, CharacterCreatePreviewSession>;
};

const PREVIEW_TTL_MS = 10 * 60 * 1000;

function getStore() {
  const globalStore = globalThis as PreviewStoreGlobal;
  if (!globalStore.__characterCreatePreviewStore) {
    globalStore.__characterCreatePreviewStore = new Map();
  }
  return globalStore.__characterCreatePreviewStore;
}

function cleanupExpiredSessions(store: Map<string, CharacterCreatePreviewSession>) {
  const now = Date.now();
  for (const [token, session] of store.entries()) {
    if (session.expiresAt <= now) {
      store.delete(token);
    }
  }
}

export function createCharacterPreviewSession(params: {
  accountId: string;
  gender: "男" | "女";
  spiritualRoot: SpiritualRoot;
  starterOptions: StarterFortuneOption[];
}) {
  const store = getStore();
  cleanupExpiredSessions(store);
  const now = Date.now();
  const token = nanoid(24);
  store.set(token, {
    accountId: params.accountId,
    gender: params.gender,
    spiritualRoot: params.spiritualRoot,
    starterOptions: params.starterOptions,
    createdAt: now,
    expiresAt: now + PREVIEW_TTL_MS,
  });
  return token;
}

export function getCharacterPreviewSession(params: {
  token: string;
  accountId: string;
}) {
  const store = getStore();
  cleanupExpiredSessions(store);
  const session = store.get(params.token);
  if (!session) {
    return null;
  }
  if (session.accountId !== params.accountId) {
    return null;
  }
  return session;
}

export function consumeCharacterPreviewSession(params: {
  token: string;
  accountId: string;
}) {
  const session = getCharacterPreviewSession(params);
  if (!session) {
    return null;
  }

  getStore().delete(params.token);
  return session;
}
