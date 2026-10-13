import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { schema } from './schema';

let pool: Pool | undefined;
let initialized: Promise<void> | undefined;

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (typeof window !== 'undefined') throw new Error('Database access is server-only');
  const connection = new URL(url);
  // Do not let URL sslmode override certificate verification in node-postgres.
  for (const key of ['sslmode', 'channel_binding', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(key);
  pool ??= new Pool({ connectionString: connection.toString(), max: 10,
    connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000,
    enableChannelBinding: true, ssl: { rejectUnauthorized: true } });
  return pool;
}

export async function ready() {
  initialized ??= database().query(schema).then(() => undefined).catch(error => { initialized = undefined; throw error; });
  await initialized;
}
export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) { await ready(); return database().query<T>(sql, values); }
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  await ready(); const client = await database().connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function closeDatabase() { if (pool) await pool.end(); pool = undefined; initialized = undefined; }
