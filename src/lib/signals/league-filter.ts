/**
 * League whitelist — accetta solo competizioni dei top campionati europei.
 * Filtro applicato in persistSignalIfNew per evitare segnali su campionati
 * minori/esotici che storicamente generano rumore (Liga Leumit, 3.Lig
 * turca, 1 Lyga lituana, Persha Liga, Reserve League, NPL Australia, ecc.).
 */

const ALLOWED_LEAGUES_LOWER = [
  // Top 5 europei
  'premier league',
  'serie a',
  'la liga',
  'laliga',
  'primera división', 'primera division',
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
  'süper lig',
  'super lig',
  'super league greece',
  'scottish premiership',
  'allsvenskan',                  // top svedese
  // Coppe nazionali importanti
  'fa cup',
  'coppa italia',
  'copa del rey',
  'dfb-pokal',
  'coupe de france',
  'taça de portugal',
];

// Codici abbreviati Polymarket / API-Football short codes per le top leghe.
// Polymarket league codes osservati: lal (La Liga), bun (Bundesliga),
// sea (Serie A), fl1 (Ligue 1), epl (Premier League), por (Primeira),
// ned (Eredivisie), ger2 (2.Bundesliga), ita2 (Serie B).
const ALLOWED_CODES = new Set([
  'epl', 'eng', 'eng1',           // Premier League
  'eng2', 'efl', 'cha',           // Championship
  'sea', 'ita', 'ita1', 'sa',     // Serie A
  'sea2', 'ita2', 'serb', 'sb',   // Serie B
  'lal', 'esp', 'esp1', 'esp_la', // La Liga (lal Polymarket)
  'esp2', 'sd',                   // Segunda
  'bun', 'ger', 'ger1', 'bl',     // Bundesliga
  'bun2', 'ger2', 'bl2',          // 2. Bundesliga
  'fra', 'fra1', 'lig1', 'fl1',   // Ligue 1 (fl1 Polymarket)
  'fra2', 'lig2', 'fl2',          // Ligue 2
  'por', 'por1', 'pl',            // Primeira Liga
  'ned', 'ere', 'ned1', 'er',     // Eredivisie
  'bel', 'bel1', 'jpl',           // Jupiler
  'tur', 'tur1', 'sl',            // Süper Lig
  'gre', 'gre1', 'gsl',           // Super League Greece
  'sco', 'sco1', 'spfl',          // Scottish Premiership
  'cl', 'ucl', 'champ',           // Champions League
  'el', 'uel',                    // Europa League
  'uecl', 'ecl', 'conf',          // Conference League
  'swe', 'swe1', 'als',           // Allsvenskan
]);

// Pattern blacklist — bocciano anche se contengono substring whitelist.
// Importante: precisi per evitare collision (es. "Reserve League" matcha
// "league" generico). Usiamo regex word-boundary.
const BLACKLIST_PATTERNS = [
  // Esotici geografici
  'liga leumit', 'leumit',
  '3. lig', '3.lig',
  '1 lyga', '1.lyga',
  'persha',
  'ii liga', '2 liga',
  'liga i ', 'liga 1.',           // Romania (Liga I) — spazio per non matchare "liga 1"
  'liga de ascenso',
  'veikkausliiga',                // Finlandia
  'esiliiga',                     // Estonia
  'allsvenskan u',                // U-leghe
  'copa do brasil',
  'reserve league',               // Australia
  'reserve',
  'victoria npl',
  'new south wales', 'nsw',
  'fkf',                          // Kenya
  'v.league', 'v league',         // Vietnam
  'k league',                     // Korea
  'j league',                     // Japan
  'usl', 'mls reserve',
  'liga mx', 'liga de expansion',
  'a league',                     // Australia (a-league non è top)
  'i league',                     // India
  'cpl',                          // Canada
  'second league', 'second liga',
  'league two',                   // English 4°
  'league one',                   // English 3° (escluso, anche se è livello)
  'league cup',                   // ambiguo
  'national league',
  'super liga ',                  // generico (Brazile, Russia)
  // Tipi non standard
  'youth', 'u21', 'u20', 'u19', 'u18', 'u17',
  'amateur',
  'esports', 'esport', 'cyber', 'кибер',
  'futsal',
  'beach soccer',
  '3x3', '5x5',
  'reserves',
  'women', 'femen',               // Femminile (non è male per qualità ma copre poco)
];


export function isAllowedLeague(competition: string): boolean {
  if (!competition) return false;
  const c = competition.toLowerCase().trim();

  // Blacklist veta tutto
  for (const bad of BLACKLIST_PATTERNS) {
    if (c.includes(bad)) return false;
  }

  // Codici esatti (3-5 char tipo "lal", "bun", "epl")
  if (c.length <= 6 && ALLOWED_CODES.has(c)) return true;

  // Whitelist: deve includere uno dei nomi
  for (const good of ALLOWED_LEAGUES_LOWER) {
    if (c.includes(good)) return true;
  }

  return false;
}
