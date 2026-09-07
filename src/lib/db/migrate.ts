import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fallback to .env if present, without overriding .env.local values

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// console, not the app's pino logger, is intentional here: this is a standalone
// CLI script (`pnpm db:migrate`) read directly by a human at a terminal, not
// part of the running server, so structured JSON log lines would be noise.

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
  }

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
  console.log("Migrations complete.");

  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
