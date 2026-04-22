import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OddsRadar — Anomaly Scanner per Bookmaker',
  description:
    'Aggregatore di quote da bookmaker internazionali. Rileva arbitraggi, value bet e steam moves in tempo reale.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="dark h-full">
      <body className="min-h-full bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
