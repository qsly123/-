import "drizzle-orm/query-promise";

declare module "drizzle-orm/query-promise" {
  interface QueryPromise<T> {
    get(): Promise<T extends Array<infer Item> ? Item | undefined : T>;
    all(): Promise<T extends Array<unknown> ? T : T[]>;
    run(): Promise<T>;
  }
}
