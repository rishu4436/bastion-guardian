import { randomBytes } from "node:crypto";
import pg from "pg";
import { closeDatabase, createDatabase, runMigrations, type Database } from "./client.js";

export const DEFAULT_TEST_ADMIN_URL = "postgresql://bastion:bastion_local_only@127.0.0.1:5432/bastion";

/** Returns the admin URL if a Postgres server is reachable, otherwise null (tests then skip with a visible reason). */
export async function probePostgres(
  url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_ADMIN_URL,
): Promise<string | null> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query("select 1");
    return url;
  } catch (e) {
    if (process.env.REQUIRE_INTEGRATION_INFRA === "true")
      throw new Error(`Postgres required but unreachable: ${String(e)}`);
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface TestDatabase {
  db: Database;
  url: string;
  drop(): Promise<void>;
}

/** Creates an isolated, migrated database (bastion_test_<random>) on the given server. */
export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `bastion_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const db = createDatabase(url, { max: 5 });
  await runMigrations(db);
  return {
    db,
    url,
    async drop() {
      await closeDatabase(db);
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
