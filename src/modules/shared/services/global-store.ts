type GlobalStore = Record<string, unknown>;

export function ensureGlobalMap<TKey, TValue>(
  globalStore: GlobalStore,
  key: string,
) {
  const current = globalStore[key];
  if (current instanceof Map) {
    return current as Map<TKey, TValue>;
  }

  const next = new Map<TKey, TValue>();
  globalStore[key] = next;
  return next;
}

export function ensureGlobalSet<TValue>(
  globalStore: GlobalStore,
  key: string,
) {
  const current = globalStore[key];
  if (current instanceof Set) {
    return current as Set<TValue>;
  }

  const next = new Set<TValue>();
  globalStore[key] = next;
  return next;
}

export function ensureGlobalArray<TValue>(
  globalStore: GlobalStore,
  key: string,
) {
  const current = globalStore[key];
  if (Array.isArray(current)) {
    return current as TValue[];
  }

  const next: TValue[] = [];
  globalStore[key] = next;
  return next;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
