import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置");
}
const resolvedDatabaseUrl = databaseUrl;

function parsePoolMax(rawValue: string | undefined) {
  const parsed = Number.parseInt(String(rawValue || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 6;
  }
  return parsed;
}

function createSqlClient() {
  return postgres(resolvedDatabaseUrl, {
    prepare: false,
    max: parsePoolMax(process.env.DATABASE_POOL_MAX),
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

function createRawDb(client: ReturnType<typeof createSqlClient>) {
  return drizzle(client, { schema });
}

type SqlClient = ReturnType<typeof createSqlClient>;
type RawDb = ReturnType<typeof createRawDb>;
type DbGlobalStore = typeof globalThis & {
  __immortalitySqlClient?: SqlClient;
  __immortalityRawDb?: RawDb;
  __immortalityWrappedDb?: RawDb;
};

type AnyObject = Record<PropertyKey, unknown>;

function isWrappable(value: unknown): value is AnyObject {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  if (value instanceof Promise) return false;

  const obj = value as AnyObject;
  if (typeof obj.then === "function" || typeof obj.execute === "function") {
    return true;
  }

  if (Object.values(obj).some((item) => typeof item === "function")) {
    return true;
  }

  const proto = Object.getPrototypeOf(value);
  if (!proto || proto === Object.prototype) {
    return false;
  }

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") continue;
    if (typeof (value as AnyObject)[key] === "function") {
      return true;
    }
  }

  return false;
}

async function execQuery(query: AnyObject): Promise<unknown> {
  if (typeof query.execute === "function") {
    return query.execute();
  }
  if (typeof query.then === "function") {
    return query;
  }
  return query;
}

function wrapQuery<T extends object>(query: T): T {
  const queryObject = query as unknown as AnyObject;
  return new Proxy(queryObject, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return async () => {
          const result = await execQuery(target);
          if (Array.isArray(result)) {
            return result[0];
          }
          return result;
        };
      }
      if (prop === "all") {
        return async () => {
          const result = await execQuery(target);
          if (Array.isArray(result)) {
            return result;
          }
          return [];
        };
      }
      if (prop === "run") {
        return async () => execQuery(target);
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const next = value.apply(target, args);
        if (isWrappable(next)) {
          return wrapQuery(next);
        }
        return next;
      };
    },
  }) as unknown as T;
}

function wrapDb<T extends object>(instance: T): T {
  const dbObject = instance as unknown as AnyObject;
  return new Proxy(dbObject, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      if (prop === "transaction") {
        return (...args: unknown[]) => {
          if (args.length === 0 || typeof args[0] !== "function") {
            return value.apply(target, args);
          }

          const userCallback = args[0] as (...callbackArgs: unknown[]) => unknown;
          const wrappedCallback = (tx: unknown, ...callbackArgs: unknown[]) => {
            const wrappedTx = isWrappable(tx) ? wrapDb(tx) : tx;
            return userCallback(wrappedTx, ...callbackArgs);
          };

          return value.apply(target, [wrappedCallback, ...args.slice(1)]);
        };
      }

      return (...args: unknown[]) => {
        const next = value.apply(target, args);
        if (isWrappable(next)) {
          return wrapQuery(next);
        }
        return next;
      };
    },
  }) as unknown as T;
}

const globalStore = globalThis as DbGlobalStore;
const client = globalStore.__immortalitySqlClient ?? createSqlClient();
if (!globalStore.__immortalitySqlClient) {
  globalStore.__immortalitySqlClient = client;
}

const rawDb = globalStore.__immortalityRawDb ?? createRawDb(client);
if (!globalStore.__immortalityRawDb) {
  globalStore.__immortalityRawDb = rawDb;
}

const wrappedDb = globalStore.__immortalityWrappedDb ?? wrapDb(rawDb);
if (!globalStore.__immortalityWrappedDb) {
  globalStore.__immortalityWrappedDb = wrappedDb;
}

export const db = wrappedDb;
export { schema };
