type RateLimitBucket = {
  count: number;
  windowStart: number;
};

type SocialRateLimitGlobal = typeof globalThis & {
  __socialRateLimitStore?: Map<string, RateLimitBucket>;
};

function getStore() {
  const globalStore = globalThis as SocialRateLimitGlobal;
  if (!globalStore.__socialRateLimitStore) {
    globalStore.__socialRateLimitStore = new Map<string, RateLimitBucket>();
  }
  return globalStore.__socialRateLimitStore;
}

export function hitSocialRateLimit(key: string, maxCount: number, windowMs: number) {
  const now = Date.now();
  const store = getStore();
  const bucket = store.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  if (bucket.count > maxCount) {
    return true;
  }
  return false;
}
