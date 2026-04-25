/**
 * League whitelist — accetta solo competizioni dei top campionati europei.
 * Filtro applicato in persistSignalIfNew per evitare segnali su campionati
 * minori/esotici che storicamente generano rumore (Liga Leumit, 3.Lig
 * turca, 1 Lyga lituana, Persha Liga, ecc.).
 */

const ALLOWED_LEAGUES_LOWER = [
  // Top 5 europei
  'premier league',
  'serie a',
  'la liga',
  'laliga',
  'bundesliga',
  'ligue 1',
  // Coppe europee
  'uefa champions league',
  'champions league',
  'uefa europa league',
  'europa league',
  'uefa conference league',
  'conference league',
  // Seconde divisioni dei top 5
  'serie b',
  'championship',
  'liga ll', // 2.bundesliga è "2. bundesliga" — gestiamo sotto
  '2. bundesliga',
  'segunda',
  'segunda división',
  'ligue 2',
  // Altre top europee
  'eredivisie',
  'primeira liga',
  'liga portugal',
  'jupiler pro league',
  'belgian pro league',
  'super lig',
  'süper lig',
  'super league greece',
  'scottish premiership',
  // Coppe nazionali importanti
  'fa cup',
  'coppa italia',
  'copa del rey',
  'dfb-pokal',
  'coupe de france',
];

// Pattern blacklist (esotici) anche se passano partial match accidentalmente
const BLACKLIST_PATTERNS = [
  'liga leumit', 'leumit',
  '3. lig', '3.lig',
  '1 lyga', '1.lyga',
  'persha liga', 'pershta liga',
  'ii liga', '2 liga',
  'youth', 'u21', 'u19', 'u20',
  'reserves', 'reserve',
  'amateur',
  'esports', 'esport', 'cyber', 'кибер',
  'futsal',
  'beach soccer',
  '3x3', '5x5',
  'liga de ascenso',
  'persha',
  'veikkausliiga', // Finlandia 1, era nei perdenti
];

export function isAllowedLeague(competition: string): boolean {
  if (!competition) return false;
  const c = competition.toLowerCase().trim();

  // Blacklist veta tutto
  for (const bad of BLACKLIST_PATTERNS) {
    if (c.includes(bad)) return false;
  }

  // Whitelist: deve includere uno dei nomi
  for (const good of ALLOWED_LEAGUES_LOWER) {
    if (c.includes(good)) return true;
  }

  return false;
}
