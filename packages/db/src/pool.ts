import pg from 'pg';

// numeric columns (money) arrive as strings to keep full precision; we convert
// explicitly with toEur() where arithmetic is needed.
export function toEur(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

/**
 * A pool for DATABASE_URL. `schema` puts every table in a separate Postgres schema
 * (used by tests so each run starts from an empty database).
 */
export function createPool(url = process.env.DATABASE_URL, schema?: string): pg.Pool {
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return new pg.Pool({
    connectionString: url,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
