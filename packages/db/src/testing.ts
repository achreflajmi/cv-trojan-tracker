import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { migrate } from './migrate.ts';
import { createPool } from './pool.ts';

export interface TestDb {
  pool: pg.Pool;
  schema: string;
  drop: () => Promise<void>;
}

/** A fresh, migrated schema in the local database; dropped after the test file. */
export async function createTestDb(): Promise<TestDb> {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = createPool();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = createPool(undefined, schema);
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
  return {
    pool,
    schema,
    drop: async () => {
      await pool.end();
      const cleanup = createPool();
      await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);
      await cleanup.end();
    },
  };
}
