// Vercel function: all /api/* requests. Storage is Postgres (Neon) via DATABASE_URL.
import { neon } from '@neondatabase/serverless';
import { pgStore } from '../server/store.js';
import { apiHandler } from '../server/app.js';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) throw new Error('Define DATABASE_URL (Postgres connection string)');
export default apiHandler(pgStore(neon(url)));
