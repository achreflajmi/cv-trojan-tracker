import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { sha256 } from '@ctt/shared';

export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

function readMigrations(dir: URL): Migration[] {
  const path = fileURLToPath(dir);
  return readdirSync(path)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      // Normalise line endings so a Windows checkout gives the same checksum as Linux CI.
      const sql = readFileSync(join(path, name), 'utf8').replaceAll('\r\n', '\n');
      return { name, sql, checksum: sha256(sql) };
    });
}

/**
 * Apply pending migrations in order, each in its own transaction. Refuses to run if
 * an already-applied file has changed: migrations are never edited after merge.
 */
export async function migrate(client: pg.ClientBase, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const applied = new Map(
    (
      await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations',
      )
    ).rows.map((r) => [r.name, r.checksum]),
  );

  const ran: string[] = [];
  for (const m of readMigrations(dir)) {
    const previous = applied.get(m.name);
    if (previous !== undefined) {
      if (previous !== m.checksum) {
        throw new Error(
          `Migration ${m.name} was edited after being applied. Add a new migration instead.`,
        );
      }
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        m.name,
        m.checksum,
      ]);
      await client.query('COMMIT');
      ran.push(m.name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${(error as Error).message}`, { cause: error });
    }
  }
  return ran;
}
