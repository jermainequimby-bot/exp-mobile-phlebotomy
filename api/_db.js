import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured.');
}

export const sql = neon(process.env.DATABASE_URL);

export function json(res, status, body) {
  return res.status(status).json(body);
}
