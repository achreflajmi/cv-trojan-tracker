import pg from 'pg';

// numeric columns (money) arrive as strings to keep full precision; we convert
// explicitly with toEur() where arithmetic is needed.
export function toEur(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

/**
 * A pool for DATABASE_URL (local, CI). Without it, the standard libpq variables
 * (PGHOST, PGUSER, PGPASSWORD, PGDATABASE) are used, as on AWS where ECS injects them
 * from the RDS-managed secret; that connection always uses verified TLS (the RDS CA
 * bundle is in the image via NODE_EXTRA_CA_CERTS).
 * `schema` puts every table in a separate Postgres schema (tests).
 */
export function createPool(url = process.env.DATABASE_URL, schema?: string): pg.Pool {
  const searchPath = schema ? { options: `-c search_path=${schema}` } : {};
  if (url) return new pg.Pool({ connectionString: url, ...searchPath });
  if (process.env.PGHOST) return new pg.Pool({ ssl: { rejectUnauthorized: true }, ...searchPath });
  throw new Error(
    'DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) is not set (see .env.example)',
  );
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
