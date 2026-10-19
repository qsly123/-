import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

type PersistedEnvelope<T> = {
  value: T;
  updatedAtMs: number;
  expiresAtMs: number | null;
};

type RuntimeNamespaceCheckpoint = {
  version: 1;
  namespace: string;
  updatedAtMs: number;
  entries: Record<string, PersistedEnvelope<unknown>>;
};

type RuntimeNamespaceCacheEntry = {
  checkpoint: RuntimeNamespaceCheckpoint;
  loadedAtMs: number;
};

type RuntimePersistedStoreStats = {
  activeRuntimeBaseDir: string | null;
  checkpointNamespaceCount: number;
  checkpointEntryCount: number;
  pendingNamespaceFlushes: number;
  runtimePersistDisabled: boolean;
};

const DEFAULT_RUNTIME_DIR = path.join(process.cwd(), ".runtime", "persisted-state");
const TEMP_RUNTIME_DIR = path.join(os.tmpdir(), "immortality-runtime", "persisted-state");
const CHECKPOINT_DIR_NAME = "checkpoints";
const LEGACY_DIR_NAME = "legacy";
const RUNTIME_PERSIST_WRITE_DEBOUNCE_MS = 250;
const runtimePersistOperationQueues = new Map<string, Promise<void>>();
const runtimePersistWarningMessages = new Set<string>();
const runtimeNamespaceCache = new Map<string, RuntimeNamespaceCacheEntry>();

type BufferedNamespaceWrite = {
  timeout: ReturnType<typeof setTimeout>;
  pendingPromise: Promise<void>;
  resolve: () => void;
};

const runtimePersistBufferedNamespaceWrites = new Map<string, BufferedNamespaceWrite>();

let activeRuntimeBaseDir = resolveConfiguredRuntimeDir() || DEFAULT_RUNTIME_DIR;
let runtimePersistDisabled = false;

function resolveConfiguredRuntimeDir() {
  const raw = process.env.RUNTIME_PERSIST_DIR?.trim();
  if (!raw) {
    return null;
  }
  return path.resolve(raw);
}

function warnRuntimePersistOnce(message: string, details?: Record<string, unknown>) {
  if (runtimePersistWarningMessages.has(message)) {
    return;
  }
  runtimePersistWarningMessages.add(message);
  if (details) {
    console.warn(message, details);
    return;
  }
  console.warn(message);
}

function buildLegacyRuntimeFilePath(baseDir: string, namespace: string, key: string) {
  const namespaceDir = path.join(baseDir, LEGACY_DIR_NAME, namespace);
  const hashedKey = createHash("sha1").update(key).digest("hex");
  return {
    namespaceDir,
    filePath: path.join(namespaceDir, `${hashedKey}.json`),
  };
}

function buildNamespaceCheckpointFilePath(baseDir: string, namespace: string) {
  const checkpointDir = path.join(baseDir, CHECKPOINT_DIR_NAME);
  const fileName = `${createHash("sha1").update(namespace).digest("hex")}.json`;
  return {
    checkpointDir,
    filePath: path.join(checkpointDir, fileName),
  };
}

function dedupeRuntimeDirs(paths: Array<string | null | undefined>) {
  const unique = new Set<string>();
  for (const currentPath of paths) {
    if (!currentPath) {
      continue;
    }
    unique.add(path.resolve(currentPath));
  }
  return Array.from(unique);
}

function getRuntimeBaseDirCandidates() {
  const configuredRuntimeDir = resolveConfiguredRuntimeDir();
  return dedupeRuntimeDirs([
    activeRuntimeBaseDir,
    configuredRuntimeDir,
    DEFAULT_RUNTIME_DIR,
    TEMP_RUNTIME_DIR,
  ]);
}

async function resolveWritableRuntimeBaseDir() {
  if (runtimePersistDisabled) {
    return null;
  }

  const preferredRuntimeDir = resolveConfiguredRuntimeDir() || DEFAULT_RUNTIME_DIR;
  let lastError: unknown = null;

  for (const candidate of getRuntimeBaseDirCandidates()) {
    try {
      await fs.promises.mkdir(candidate, { recursive: true });
      if (activeRuntimeBaseDir !== candidate) {
        activeRuntimeBaseDir = candidate;
      }
      if (candidate !== preferredRuntimeDir) {
        warnRuntimePersistOnce("Runtime persisted store switched to fallback directory.", {
          preferredRuntimeDir,
          activeRuntimeBaseDir: candidate,
        });
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  runtimePersistDisabled = true;
  warnRuntimePersistOnce("Runtime persisted store disabled because no writable directory is available.", {
    candidates: getRuntimeBaseDirCandidates(),
    lastError,
  });
  return null;
}

function resolveWritableRuntimeBaseDirSync() {
  if (runtimePersistDisabled) {
    return null;
  }

  const preferredRuntimeDir = resolveConfiguredRuntimeDir() || DEFAULT_RUNTIME_DIR;
  let lastError: unknown = null;

  for (const candidate of getRuntimeBaseDirCandidates()) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      if (activeRuntimeBaseDir !== candidate) {
        activeRuntimeBaseDir = candidate;
      }
      if (candidate !== preferredRuntimeDir) {
        warnRuntimePersistOnce("Runtime persisted store switched to fallback directory.", {
          preferredRuntimeDir,
          activeRuntimeBaseDir: candidate,
        });
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  runtimePersistDisabled = true;
  warnRuntimePersistOnce("Runtime persisted store disabled because no writable directory is available.", {
    candidates: getRuntimeBaseDirCandidates(),
    lastError,
  });
  return null;
}

function createEmptyCheckpoint(namespace: string): RuntimeNamespaceCheckpoint {
  return {
    version: 1,
    namespace,
    updatedAtMs: Date.now(),
    entries: {},
  };
}

function readLegacyPersistedRuntimeValueFromFile<T>(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as PersistedEnvelope<T>;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  return parsed;
}

function cloneCheckpoint(checkpoint: RuntimeNamespaceCheckpoint): RuntimeNamespaceCheckpoint {
  return {
    version: 1,
    namespace: checkpoint.namespace,
    updatedAtMs: checkpoint.updatedAtMs,
    entries: { ...checkpoint.entries },
  };
}

function isPersistedEntryExpired(entry: PersistedEnvelope<unknown> | null | undefined, nowMs = Date.now()) {
  return Boolean(
    entry
      && typeof entry.expiresAtMs === "number"
      && entry.expiresAtMs <= nowMs,
  );
}

function normalizeCheckpoint(namespace: string, parsed: unknown) {
  if (!parsed || typeof parsed !== "object") {
    return createEmptyCheckpoint(namespace);
  }

  const rawEntries = (parsed as { entries?: Record<string, PersistedEnvelope<unknown>> }).entries;
  const entries = rawEntries && typeof rawEntries === "object" && !Array.isArray(rawEntries)
    ? rawEntries
    : {};

  const checkpoint: RuntimeNamespaceCheckpoint = {
    version: 1,
    namespace,
    updatedAtMs: Number((parsed as { updatedAtMs?: number }).updatedAtMs || Date.now()),
    entries: {},
  };

  const nowMs = Date.now();
  for (const [key, value] of Object.entries(entries)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry: PersistedEnvelope<unknown> = {
      value: (value as PersistedEnvelope<unknown>).value,
      updatedAtMs: Number((value as PersistedEnvelope<unknown>).updatedAtMs || nowMs),
      expiresAtMs: typeof (value as PersistedEnvelope<unknown>).expiresAtMs === "number"
        ? Number((value as PersistedEnvelope<unknown>).expiresAtMs)
        : null,
    };
    if (isPersistedEntryExpired(entry, nowMs)) {
      continue;
    }
    checkpoint.entries[key] = entry;
  }

  return checkpoint;
}

function loadNamespaceCheckpointFromDisk(namespace: string): RuntimeNamespaceCheckpoint | null {
  for (const baseDir of getRuntimeBaseDirCandidates()) {
    try {
      const { filePath } = buildNamespaceCheckpointFilePath(baseDir, namespace);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const raw = fs.readFileSync(filePath, "utf8");
      return normalizeCheckpoint(namespace, JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return null;
}

function getNamespaceCheckpoint(namespace: string) {
  const normalizedNamespace = String(namespace || "").trim();
  if (!normalizedNamespace) {
    return createEmptyCheckpoint("");
  }

  const cached = runtimeNamespaceCache.get(normalizedNamespace);
  if (cached) {
    return cloneCheckpoint(cached.checkpoint);
  }

  const diskCheckpoint = loadNamespaceCheckpointFromDisk(normalizedNamespace) || createEmptyCheckpoint(normalizedNamespace);
  runtimeNamespaceCache.set(normalizedNamespace, {
    checkpoint: cloneCheckpoint(diskCheckpoint),
    loadedAtMs: Date.now(),
  });
  return cloneCheckpoint(diskCheckpoint);
}

function setNamespaceCheckpoint(namespace: string, checkpoint: RuntimeNamespaceCheckpoint) {
  runtimeNamespaceCache.set(namespace, {
    checkpoint: cloneCheckpoint(checkpoint),
    loadedAtMs: Date.now(),
  });
}

function buildRuntimeOperationKey(namespace: string) {
  return namespace;
}

function clearBufferedNamespaceWrite(operationKey: string) {
  const bufferedWrite = runtimePersistBufferedNamespaceWrites.get(operationKey);
  if (!bufferedWrite) {
    return null;
  }

  clearTimeout(bufferedWrite.timeout);
  runtimePersistBufferedNamespaceWrites.delete(operationKey);
  bufferedWrite.resolve();
  return bufferedWrite;
}

function enqueueRuntimePersistOperation(
  namespace: string,
  operation: () => Promise<void>,
) {
  const operationKey = buildRuntimeOperationKey(namespace);
  const previousOperation = runtimePersistOperationQueues.get(operationKey) || Promise.resolve();
  const nextOperation = previousOperation
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      console.error("Runtime persisted store operation failed:", {
        namespace,
        error,
      });
    })
    .finally(() => {
      if (runtimePersistOperationQueues.get(operationKey) === nextOperation) {
        runtimePersistOperationQueues.delete(operationKey);
      }
    });

  runtimePersistOperationQueues.set(operationKey, nextOperation);
  return nextOperation;
}

async function flushNamespaceCheckpoint(namespace: string) {
  const runtimeBaseDir = await resolveWritableRuntimeBaseDir();
  if (!runtimeBaseDir) {
    return;
  }

  const checkpoint = getNamespaceCheckpoint(namespace);
  const { checkpointDir, filePath } = buildNamespaceCheckpointFilePath(runtimeBaseDir, namespace);
  const tempFilePath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  try {
    await fs.promises.mkdir(checkpointDir, { recursive: true });
    checkpoint.updatedAtMs = Date.now();
    await fs.promises.writeFile(tempFilePath, JSON.stringify(checkpoint), "utf8");
    await fs.promises.rename(tempFilePath, filePath);
  } finally {
    await fs.promises.unlink(tempFilePath).catch(() => {});
  }
}

function flushNamespaceCheckpointSync(namespace: string) {
  const runtimeBaseDir = resolveWritableRuntimeBaseDirSync();
  if (!runtimeBaseDir) {
    return false;
  }

  const checkpoint = getNamespaceCheckpoint(namespace);
  const { checkpointDir, filePath } = buildNamespaceCheckpointFilePath(runtimeBaseDir, namespace);
  const tempFilePath = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(checkpointDir, { recursive: true });
    checkpoint.updatedAtMs = Date.now();
    fs.writeFileSync(tempFilePath, JSON.stringify(checkpoint), "utf8");
    fs.renameSync(tempFilePath, filePath);
    return true;
  } catch (error) {
    console.error("Runtime persisted store immediate write failed:", {
      namespace,
      error,
    });
    return false;
  } finally {
    try {
      fs.unlinkSync(tempFilePath);
    } catch {}
  }
}

function readLegacyPersistedRuntimeValue<T>(namespace: string, key: string): PersistedEnvelope<T> | null {
  for (const baseDir of getRuntimeBaseDirCandidates()) {
    try {
      const { filePath } = buildLegacyRuntimeFilePath(baseDir, namespace, key);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const parsed = readLegacyPersistedRuntimeValueFromFile<T>(filePath);
      if (!parsed) {
        return null;
      }
      if (typeof parsed.expiresAtMs === "number" && parsed.expiresAtMs <= Date.now()) {
        void fs.promises.unlink(filePath).catch(() => {});
        return null;
      }
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export function readPersistedRuntimeValue<T>(namespace: string, key: string): T | null {
  const checkpoint = getNamespaceCheckpoint(namespace);
  const entry = checkpoint.entries[key];
  if (entry && !isPersistedEntryExpired(entry)) {
    return (entry.value as T) ?? null;
  }

  if (entry && isPersistedEntryExpired(entry)) {
    delete checkpoint.entries[key];
    setNamespaceCheckpoint(namespace, checkpoint);
  }

  const legacyValue = readLegacyPersistedRuntimeValue<T>(namespace, key);
  if (legacyValue) {
    checkpoint.entries[key] = legacyValue;
    setNamespaceCheckpoint(namespace, checkpoint);
    return legacyValue.value ?? null;
  }

  return null;
}

export function listPersistedRuntimeValues<T>(namespace: string): T[] {
  const checkpoint = getNamespaceCheckpoint(namespace);
  const nowMs = Date.now();
  let changed = false;
  const collected: T[] = [];

  for (const [key, entry] of Object.entries(checkpoint.entries)) {
    if (isPersistedEntryExpired(entry, nowMs)) {
      delete checkpoint.entries[key];
      changed = true;
      continue;
    }
    if (entry.value !== undefined && entry.value !== null) {
      collected.push(entry.value as T);
    }
  }

  if (changed) {
    setNamespaceCheckpoint(namespace, checkpoint);
  }

  return collected;
}

function queueNamespaceFlush(namespace: string) {
  const operationKey = buildRuntimeOperationKey(namespace);
  const flushBufferedWrite = (bufferedWrite: BufferedNamespaceWrite) => {
    runtimePersistBufferedNamespaceWrites.delete(operationKey);
    void enqueueRuntimePersistOperation(namespace, async () => {
      await flushNamespaceCheckpoint(namespace);
    }).finally(() => {
      bufferedWrite.resolve();
    });
  };

  const existingBufferedWrite = runtimePersistBufferedNamespaceWrites.get(operationKey);
  if (existingBufferedWrite) {
    clearTimeout(existingBufferedWrite.timeout);
    existingBufferedWrite.timeout = setTimeout(() => {
      flushBufferedWrite(existingBufferedWrite);
    }, RUNTIME_PERSIST_WRITE_DEBOUNCE_MS);
    return existingBufferedWrite.pendingPromise;
  }

  let resolveBufferedWrite = () => {};
  const pendingPromise = new Promise<void>((resolve) => {
    resolveBufferedWrite = resolve;
  });
  const bufferedWrite: BufferedNamespaceWrite = {
    timeout: setTimeout(() => {
      flushBufferedWrite(bufferedWrite);
    }, RUNTIME_PERSIST_WRITE_DEBOUNCE_MS),
    pendingPromise,
    resolve: resolveBufferedWrite,
  };
  runtimePersistBufferedNamespaceWrites.set(operationKey, bufferedWrite);
  return pendingPromise;
}

export function writePersistedRuntimeValue<T>(
  namespace: string,
  key: string,
  value: T,
  options?: { ttlMs?: number },
) {
  const checkpoint = getNamespaceCheckpoint(namespace);
  checkpoint.entries[key] = {
    value,
    updatedAtMs: Date.now(),
    expiresAtMs: typeof options?.ttlMs === "number" && options.ttlMs > 0
      ? Date.now() + options.ttlMs
      : null,
  };
  setNamespaceCheckpoint(namespace, checkpoint);
  return queueNamespaceFlush(namespace);
}

export function writePersistedRuntimeValueNow<T>(
  namespace: string,
  key: string,
  value: T,
  options?: { ttlMs?: number },
) {
  const checkpoint = getNamespaceCheckpoint(namespace);
  checkpoint.entries[key] = {
    value,
    updatedAtMs: Date.now(),
    expiresAtMs: typeof options?.ttlMs === "number" && options.ttlMs > 0
      ? Date.now() + options.ttlMs
      : null,
  };
  setNamespaceCheckpoint(namespace, checkpoint);
  clearBufferedNamespaceWrite(namespace);
  return flushNamespaceCheckpointSync(namespace);
}

export function deletePersistedRuntimeValue(namespace: string, key: string) {
  const checkpoint = getNamespaceCheckpoint(namespace);
  if (!(key in checkpoint.entries)) {
    return Promise.resolve();
  }
  delete checkpoint.entries[key];
  setNamespaceCheckpoint(namespace, checkpoint);
  clearBufferedNamespaceWrite(namespace);
  return enqueueRuntimePersistOperation(namespace, async () => {
    await flushNamespaceCheckpoint(namespace);
  });
}

export function collectRuntimePersistedStoreStats(): RuntimePersistedStoreStats {
  let checkpointEntryCount = 0;
  for (const entry of runtimeNamespaceCache.values()) {
    checkpointEntryCount += Object.keys(entry.checkpoint.entries || {}).length;
  }

  return {
    activeRuntimeBaseDir: runtimePersistDisabled ? null : activeRuntimeBaseDir,
    checkpointNamespaceCount: runtimeNamespaceCache.size,
    checkpointEntryCount,
    pendingNamespaceFlushes: runtimePersistBufferedNamespaceWrites.size,
    runtimePersistDisabled,
  };
}
