import { pool } from './pool.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

export async function createUser(id: string, email: string, passwordHash: string): Promise<User> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, password_hash`,
    [id, email.toLowerCase(), passwordHash],
  );
  const row = rows[0]!;
  return { id: row.id, email: row.email, passwordHash: row.password_hash };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, passwordHash: row.password_hash };
}
