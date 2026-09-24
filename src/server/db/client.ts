import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { sql?: postgres.Sql; db?: Db };

function connect() {
  // prepare: false because Supabase's transaction pooler (port 6543) does not support
  // prepared statements across pooled connections.
  const sql = postgres(env().DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { sql, db: drizzle(sql, { schema }) };
}

export function db(): Db {
  if (!globalForDb.db) {
    const { sql, db } = connect();
    globalForDb.sql = sql;
    globalForDb.db = db;
  }
  return globalForDb.db;
}

export async function closeDb() {
  await globalForDb.sql?.end({ timeout: 5 });
  globalForDb.sql = undefined;
  globalForDb.db = undefined;
}
