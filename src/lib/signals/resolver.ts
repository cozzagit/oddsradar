/**
 * Signal resolver — dato un signal chiuso (evento finito) e il punteggio
 * finale, determina se la predizione è vinta/persa/annullata.
 */

export type Outcome = 'won' | 'lost' | 'void' | 'unknown';

export function resolveOutcome(
  marketSlug: string,
  selectionSlug: string,
  homeGoals: number | null,
  awayGoals: number | null,
  handicap: number | null = 2.5,
): Outcome {
  if (homeGoals == null || awayGoals == null) return 'unknown';

  if (marketSlug === 'match_1x2') {
    if (selectionSlug === 'home') {
      return homeGoals > awayGoals ? 'won' : 'lost';
    }
    if (selectionSlug === 'draw') {
      return homeGoals === awayGoals ? 'won' : 'lost';
    }
    if (selectionSlug === 'away') {
      return awayGoals > homeGoals ? 'won' : 'lost';
    }
    return 'unknown';
  }

  if (marketSlug === 'over_under_2_5') {
    const total = homeGoals + awayGoals;
    const line = handicap ?? 2.5;
    if (selectionSlug === 'over') {
      if (total > line) return 'won';
      if (total < line) return 'lost';
      return 'void'; // push (raro con .5)
    }
    if (selectionSlug === 'under') {
      if (total < line) return 'won';
      if (total > line) return 'lost';
      return 'void';
    }
    return 'unknown';
  }

  if (marketSlug === 'btts') {
    const both = homeGoals > 0 && awayGoals > 0;
    if (selectionSlug === 'yes') return both ? 'won' : 'lost';
    if (selectionSlug === 'no') return both ? 'lost' : 'won';
    return 'unknown';
  }

  return 'unknown';
}

/**
 * Simula profitto da uno stake fisso dato odd e outcome.
 * stake = puntata, odd = quota decimale.
 * WON: profit = stake * (odd - 1)
 * LOST: profit = -stake
 * VOID: profit = 0
 * UNKNOWN: 0 (non giocabile)
 */
export function simulateProfit(stake: number, odd: number, outcome: Outcome): number {
  if (outcome === 'won') return Number((stake * (odd - 1)).toFixed(2));
  if (outcome === 'lost') return Number((-stake).toFixed(2));
  return 0;
}
