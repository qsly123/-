import { nanoid } from "nanoid";
import type { ClientActionRequestMeta } from "@/types/game";

export function createActionRequestMeta(overrides?: ClientActionRequestMeta) {
  return {
    actionId: nanoid(16),
    clientSentAt: Date.now(),
    ...overrides,
  };
}
