import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const ROOT = new URL("../../", import.meta.url);
const SKIPPED = "20260615000003_enable_pg_cron_pg_net.sql";

export function restoreDatabase(backup) {
  return new PGlite({ extensions: { vector, pgcrypto, pg_trgm }, loadDataDir: backup });
}

export async function createLegacyDatabase() {
  const db = new PGlite({ extensions: { vector, pgcrypto, pg_trgm } });
  const applied = [];
  try {
    await db.exec(await readFile(new URL("tests/db/platform-fixture.sql", ROOT), "utf8"));
    const files = (await readdir(new URL("supabase/migrations/", ROOT))).sort();
    for (const file of files.filter((name) => name.endsWith(".sql") && name < "20261010")) {
      if (file === SKIPPED) continue;
      try {
        await db.exec(await readFile(new URL("supabase/migrations/" + file, ROOT), "utf8"));
      } catch (error) {
        throw new Error("Legacy migration " + file + ": " + error.message);
      }
      applied.push(file);
    }
    return { db, applied, skipped: [SKIPPED] };
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function applyOmnichannelMigrations(db) {
  const files = (await readdir(new URL("supabase/migrations/", ROOT))).sort();
  for (const file of files.filter((name) => /_omnichannel_.*\.sql$/.test(name))) {
    await db.exec(await readFile(new URL("supabase/migrations/" + file, ROOT), "utf8"));
  }
}
