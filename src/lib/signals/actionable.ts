/** Trasforma il payload di un signal in una spiegazione actionable per lo scommettitore. */

export type SignalType = 'arb' | 'value' | 'steam';

export interface ArbLeg {
  bookSlug: string;
  selectionSlug: string;
  odd: number;
  stakeShare: number;
}

export interface ActionableArb {
  kind: 'arb';
  totalStake: number; // riferimento: 100
  legs: Array<{
    label: string; // "Vittoria Casa", "Pareggio", "Vittoria Trasferta", "Over 2.5", "Under 2.5"
    bookName: string;
    odd: number;
    stake: number; // euro su base 100
    return: number; // ritorno se vince questa
  }>;
  guaranteedProfit: number; // su base 100
  guaranteedProfitPct: number;
  feasibility: 'easy' | 'medium' | 'hard'; // in base ai book
  feasibilityReason: string;
}

export interface ActionableValue {
  kind: 'value';
  label: string;
  bookName: string;
  offeredOdd: number;
  fairOdd: number;
  impliedProb: number;
  fairProb: number;
  edgePct: number;
  suggestedStakePctBankroll: number; // Kelly frazionato (1/4 Kelly)
  reasoning: string;
}

const BOOK_NAMES: Record<string, string> = {
  pinnacle: 'Pinnacle',
  betfair_ex: 'Betfair Exchange',
  smarkets: 'Smarkets',
  sbobet: 'SBOBet',
  bet365: 'Bet365',
  snai: 'Snai',
  goldbet: 'Goldbet',
  sisal: 'Sisal',
  eurobet: 'Eurobet',
  '1xbet': '1xBet',
  matchbook: 'Matchbook',
  mozzart: 'Mozzart',
  meridianbet: 'Meridianbet',
  superbet: 'SuperBet',
  betano: 'Betano',
  fonbet: 'Fonbet',
  parimatch: 'Parimatch',
  sportybet: 'SportyBet',
  dafabet: 'Dafabet',
  '188bet': '188bet',
};

const SELECTION_LABELS: Record<string, (home: string, away: string) => string> = {
  home: (h) => `Vittoria ${h}`,
  draw: () => `Pareggio`,
  away: (_, a) => `Vittoria ${a}`,
  over: () => `Over 2.5 goal`,
  under: () => `Under 2.5 goal`,
  yes: () => `Goal (entrambe segnano)`,
  no: () => `No Goal`,
};

export function bookLabel(slug: string): string {
  return BOOK_NAMES[slug] ?? slug;
}

export function selectionLabel(selSlug: string, home: string, away: string): string {
  const fn = SELECTION_LABELS[selSlug];
  return fn ? fn(home, away) : selSlug;
}

// Sharp/exchange books → servono conti dedicati, scommettitori italiani medi non li hanno.
const SHARP_EXCHANGE = new Set(['pinnacle', 'betfair_ex', 'smarkets', 'matchbook', 'sbobet']);
// Book ADM italiani comunemente accessibili
const ADM_IT = new Set(['snai', 'goldbet', 'sisal', 'eurobet']);

export function buildActionableArb(
  legs: ArbLeg[],
  edge: number,
  home: string,
  away: string,
  totalStake = 100,
): ActionableArb {
  const builtLegs = legs.map((l) => {
    const stake = Number((l.stakeShare * totalStake).toFixed(2));
    const ret = Number((stake * l.odd).toFixed(2));
    return {
      label: selectionLabel(l.selectionSlug, home, away),
      bookName: bookLabel(l.bookSlug),
      odd: l.odd,
      stake,
      return: ret,
    };
  });

  const minReturn = Math.min(...builtLegs.map((l) => l.return));
  const guaranteedProfit = Number((minReturn - totalStake).toFixed(2));

  const bookSlugs = legs.map((l) => l.bookSlug);
  const allSharp = bookSlugs.every((s) => SHARP_EXCHANGE.has(s));
  const anyAdm = bookSlugs.some((s) => ADM_IT.has(s));
  let feasibility: ActionableArb['feasibility'] = 'medium';
  let feasibilityReason = '';
  if (allSharp) {
    feasibility = 'hard';
    feasibilityReason =
      'Tutte le zampe richiedono conti su exchange (Betfair/Smarkets) o Pinnacle: liquidità variabile, non disponibili direttamente ai normali scommettitori italiani.';
  } else if (anyAdm) {
    feasibility = 'easy';
    feasibilityReason = 'Include un book ADM italiano, più facile da eseguire.';
  } else {
    feasibility = 'medium';
    feasibilityReason =
      'Book accessibili ma richiedono più conti attivi; le quote possono muoversi rapidamente.';
  }

  return {
    kind: 'arb',
    totalStake,
    legs: builtLegs,
    guaranteedProfit,
    guaranteedProfitPct: Number((edge * 100).toFixed(2)),
    feasibility,
    feasibilityReason,
  };
}

export function buildActionableValue(
  bookSlug: string,
  selSlug: string,
  offeredOdd: number,
  fairOdd: number,
  fairProb: number,
  edge: number,
  home: string,
  away: string,
): ActionableValue {
  const impliedProb = 1 / offeredOdd;
  // Kelly frazionato 1/4 (conservativo per rumore del fair value)
  const kelly = (offeredOdd * fairProb - 1) / (offeredOdd - 1);
  const suggestedStakePctBankroll = Math.max(0, Math.min(0.05, kelly / 4));

  const reasoning =
    `La quota su ${bookLabel(bookSlug)} (${offeredOdd.toFixed(2)}) implica ${(impliedProb * 100).toFixed(1)}% di probabilità, ` +
    `ma il consenso dei book "sharp" (Pinnacle/Betfair/Smarkets) stima la probabilità reale al ${(fairProb * 100).toFixed(1)}%. ` +
    `Il book ha sottostimato l'evento: giocando qui hai un vantaggio atteso del ${(edge * 100).toFixed(2)}%.`;

  return {
    kind: 'value',
    label: selectionLabel(selSlug, home, away),
    bookName: bookLabel(bookSlug),
    offeredOdd,
    fairOdd,
    impliedProb,
    fairProb,
    edgePct: Number((edge * 100).toFixed(2)),
    suggestedStakePctBankroll: Number((suggestedStakePctBankroll * 100).toFixed(2)),
    reasoning,
  };
}
