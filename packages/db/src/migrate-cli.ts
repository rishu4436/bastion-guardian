import { closeDatabase, createDatabase, runMigrations } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDatabase(url, { max: 1 });
await runMigrations(db);
await closeDatabase(db);
console.log("migrations applied");
