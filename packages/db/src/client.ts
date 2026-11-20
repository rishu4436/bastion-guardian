import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDatabase(connectionString: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  return drizzle(pool, { schema }) as Database;
}

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.$client.end();
}
