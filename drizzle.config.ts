import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://oddsradar:oddsradar@localhost:5432/oddsradar',
  },
  verbose: true,
  strict: true,
} satisfies Config;
