import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __scholasticSql: ReturnType<typeof postgres> | undefined;
}

function createSqlClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
  }
  // postgres.js defaults connect_timeout to 30s. The database is an optional
  // accelerator here — the search cache and work persistence both degrade
  // gracefully when it's unreachable — so an unreachable host must fail fast
  // instead of holding every search request open for half a minute.
  return postgres(connectionString, { max: 10, connect_timeout: 5 });
}

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Lazy on purpose: merely importing this module (or anything that transitively
 * imports it) must never attempt a database connection or throw for missing
 * DATABASE_URL — only calling getDb() does. This keeps modules like the
 * resilience layer safe to import in contexts without a configured database
 * (unit tests, build-time route collection).
 */
export function getDb() {
  if (!dbInstance) {
    // Reuse the connection across hot reloads in dev so we don't exhaust the pool.
    const sql = globalThis.__scholasticSql ?? createSqlClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.__scholasticSql = sql;
    }
    dbInstance = drizzle(sql, { schema });
  }
  return dbInstance;
}
