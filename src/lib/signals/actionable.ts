/** Labels e nomi book per UI/Telegram. */

const BOOK_NAMES: Record<string, string> = {
  pinnacle: 'Pinnacle',
  betfair_ex: 'Betfair Exchange',
  smarkets: 'Smarkets',
  matchbook: 'Matchbook',
  sbobet: 'SBOBet',
  bet365: 'Bet365',
  unibet: 'Unibet',
  snai: 'Snai',
  goldbet: 'Goldbet',
  sisal: 'Sisal',
  eurobet: 'Eurobet',
  williamhill: 'William Hill',
  bwin: 'Bwin',
  '1xbet': '1xBet',
  '188bet': '188bet',
  dafabet: 'Dafabet',
  mozzart: 'Mozzart',
  meridianbet: 'Meridianbet',
  superbet: 'SuperBet',
  betano: 'Betano',
  fonbet: 'Fonbet',
  parimatch: 'Parimatch',
  sportybet: 'SportyBet',
};

export function bookLabel(slug: string): string {
  return BOOK_NAMES[slug] ?? slug;
}

const SELECTION_LABELS: Record<string, (home: string, away: string) => string> = {
  home: (h) => `Vittoria ${h}`,
  draw: () => `Pareggio`,
  away: (_, a) => `Vittoria ${a}`,
  over: () => `Over 2.5 goal`,
  under: () => `Under 2.5 goal`,
  yes: () => `Goal (entrambe segnano)`,
  no: () => `No Goal`,
};

export function selectionLabel(selSlug: string, home: string, away: string): string {
  const fn = SELECTION_LABELS[selSlug];
  return fn ? fn(home, away) : selSlug;
}
