import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, schema } from '@/lib/db';

const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & { id: string; role: string };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const normalized = email.toLowerCase();
        if (allowedEmails.length > 0 && !allowedEmails.includes(normalized)) return null;

        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, normalized))
          .limit(1);
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: String(user.id),
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? 'viewer';
      }
      return token;
    },
    session: ({ session, token }) => {
      if (token) {
        session.user.id = String(token.id);
        session.user.role = String(token.role);
      }
      return session;
    },
  },
});
