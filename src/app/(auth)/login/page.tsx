import { Suspense } from 'react';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
          <p className="text-center text-sm text-zinc-500">Caricamento…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
