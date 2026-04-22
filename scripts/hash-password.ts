import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';

async function main() {
  const [, , emailArg, passwordArg] = process.argv;
  if (!emailArg || !passwordArg) {
    console.error('Usage: npm run hash:password -- <email> <password>');
    process.exit(1);
  }
  const email = emailArg.toLowerCase();
  const passwordHash = await bcrypt.hash(passwordArg, 12);
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (existing.length > 0) {
    await db
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.email, email));
    console.log('Password updated for', email);
  } else {
    await db.insert(schema.users).values({ email, passwordHash, role: 'admin' });
    console.log('User created:', email);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
