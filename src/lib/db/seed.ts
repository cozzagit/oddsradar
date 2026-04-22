import 'dotenv/config';
import { db } from './index';
import { sports, markets, selections, books } from './schema';

async function seed() {
  console.log('Seeding sports...');
  const insertedSports = await db
    .insert(sports)
    .values([
      { slug: 'soccer', name: 'Calcio' },
      { slug: 'tennis', name: 'Tennis' },
      { slug: 'basketball', name: 'Basket' },
    ])
    .onConflictDoNothing()
    .returning();
  console.log(`  ${insertedSports.length} sports`);

  console.log('Seeding markets...');
  const marketsInserted = await db
    .insert(markets)
    .values([
      { slug: 'match_1x2', name: '1X2 (Match Result)', type: '1x2' },
      { slug: 'over_under_2_5', name: 'Over/Under 2.5', type: 'ou', config: { line: 2.5 } },
      { slug: 'btts', name: 'Both Teams To Score', type: 'btts' },
      { slug: 'asian_handicap', name: 'Asian Handicap', type: 'ah' },
    ])
    .onConflictDoNothing()
    .returning();
  console.log(`  ${marketsInserted.length} markets`);

  console.log('Seeding selections (1X2)...');
  const all = await db.select().from(markets);
  const m1x2 = all.find((m) => m.slug === 'match_1x2');
  const mou = all.find((m) => m.slug === 'over_under_2_5');
  const mbtts = all.find((m) => m.slug === 'btts');
  if (m1x2) {
    await db
      .insert(selections)
      .values([
        { marketId: m1x2.id, slug: 'home', name: '1 (Home)' },
        { marketId: m1x2.id, slug: 'draw', name: 'X (Draw)' },
        { marketId: m1x2.id, slug: 'away', name: '2 (Away)' },
      ])
      .onConflictDoNothing();
  }
  if (mou) {
    await db
      .insert(selections)
      .values([
        { marketId: mou.id, slug: 'over', name: 'Over 2.5' },
        { marketId: mou.id, slug: 'under', name: 'Under 2.5' },
      ])
      .onConflictDoNothing();
  }
  if (mbtts) {
    await db
      .insert(selections)
      .values([
        { marketId: mbtts.id, slug: 'yes', name: 'Yes' },
        { marketId: mbtts.id, slug: 'no', name: 'No' },
      ])
      .onConflictDoNothing();
  }

  console.log('Seeding books...');
  await db
    .insert(books)
    .values([
      { slug: 'pinnacle', name: 'Pinnacle', country: 'CUW', tier: 'easy', isSharp: true },
      { slug: 'betfair_ex', name: 'Betfair Exchange', country: 'GBR', tier: 'easy', isSharp: true },
      { slug: 'smarkets', name: 'Smarkets', country: 'GBR', tier: 'easy', isSharp: true },
      { slug: 'sbobet', name: 'SBOBet', country: 'PHL', tier: 'medium', isSharp: true },
      { slug: 'bet365', name: 'Bet365', country: 'GBR', tier: 'hard' },
      { slug: 'snai', name: 'Snai', country: 'ITA', tier: 'medium' },
      { slug: 'goldbet', name: 'Goldbet', country: 'ITA', tier: 'medium' },
      { slug: 'sisal', name: 'Sisal', country: 'ITA', tier: 'medium' },
      { slug: 'eurobet', name: 'Eurobet', country: 'ITA', tier: 'medium' },
      { slug: '1xbet', name: '1xBet', country: 'RUS', tier: 'hard' },
      { slug: 'mozzart', name: 'Mozzart Bet', country: 'SRB', tier: 'medium' },
      { slug: 'meridianbet', name: 'Meridianbet', country: 'MNE', tier: 'medium' },
      { slug: 'superbet', name: 'SuperBet', country: 'ROU', tier: 'medium' },
      { slug: 'betano', name: 'Betano', country: 'GRC', tier: 'medium' },
      { slug: 'fonbet', name: 'Fonbet', country: 'RUS', tier: 'hard' },
      { slug: 'parimatch', name: 'Parimatch', country: 'CYP', tier: 'medium' },
      { slug: 'sportybet', name: 'SportyBet', country: 'NGA', tier: 'medium' },
      { slug: 'dafabet', name: 'Dafabet', country: 'PHL', tier: 'medium' },
      { slug: '188bet', name: '188bet', country: 'PHL', tier: 'medium' },
    ])
    .onConflictDoNothing();

  console.log('✓ Seed completed');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
