import { pool } from './pool.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flows (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  graph         JSONB NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS runs_flow_id_idx ON runs(flow_id);
CREATE INDEX IF NOT EXISTS flows_user_id_idx ON flows(user_id);

-- idempotent: add user_id to pre-existing flows tables
ALTER TABLE flows ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
`;

async function main() {
  await pool.query(SCHEMA);
  console.log('migrations applied');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
