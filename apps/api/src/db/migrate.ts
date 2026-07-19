/**
 * Minimal SQL migration runner.
 * Applies apps/api/migrations/*.sql in filename order, each inside a
 * transaction, recording applied files in schema_migrations.
 *
 * Usage: npm run migrate
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`apply  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`FAILED ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('migrations up to date');
}

migrate()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
    return pool.end();
  });
