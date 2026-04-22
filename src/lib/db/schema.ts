import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  varchar,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const sourceTierEnum = pgEnum('source_tier', ['easy', 'medium', 'hard']);
export const signalTypeEnum = pgEnum('signal_type', ['arb', 'value', 'steam', 'bet']);
export const signalStatusEnum = pgEnum('signal_status', ['active', 'expired', 'consumed']);
export const eventStatusEnum = pgEnum('event_status', [
  'scheduled',
  'in_play',
  'finished',
  'postponed',
  'cancelled',
]);
export const ingestionStatusEnum = pgEnum('ingestion_status', [
  'running',
  'success',
  'partial',
  'failed',
]);
export const mappingStatusEnum = pgEnum('mapping_status', ['pending', 'resolved', 'rejected']);
export const userRoleEnum = pgEnum('user_role', ['admin', 'viewer']);

export const sports = pgTable('sports', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const competitions = pgTable(
  'competitions',
  {
    id: serial('id').primaryKey(),
    sportId: integer('sport_id')
      .notNull()
      .references(() => sports.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 128 }).notNull(),
    name: text('name').notNull(),
    country: varchar('country', { length: 3 }),
    externalIds: jsonb('external_ids').$type<Record<string, string>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqSportSlug: uniqueIndex('uniq_competition_sport_slug').on(t.sportId, t.slug),
  }),
);

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    sportId: integer('sport_id')
      .notNull()
      .references(() => sports.id, { onDelete: 'cascade' }),
    nameCanonical: text('name_canonical').notNull(),
    country: varchar('country', { length: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxSportName: index('idx_teams_sport_name').on(t.sportId, t.nameCanonical),
  }),
);

export const teamAliases = pgTable(
  'team_aliases',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    sourceBookId: integer('source_book_id'),
    confidence: doublePrecision('confidence').default(1).notNull(),
    verified: boolean('verified').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqAlias: uniqueIndex('uniq_team_alias').on(t.teamId, t.alias),
    idxAlias: index('idx_team_alias_trgm').on(t.alias),
  }),
);

export const books = pgTable('books', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: text('name').notNull(),
  country: varchar('country', { length: 3 }),
  tier: sourceTierEnum('tier').notNull().default('medium'),
  isSharp: boolean('is_sharp').default(false).notNull(),
  rateLimitRpm: integer('rate_limit_rpm').default(60).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const markets = pgTable('markets', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: text('name').notNull(),
  type: varchar('type', { length: 32 }).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
});

export const selections = pgTable(
  'selections',
  {
    id: serial('id').primaryKey(),
    marketId: integer('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: text('name').notNull(),
  },
  (t) => ({
    uniqMarketSlug: uniqueIndex('uniq_selection_market_slug').on(t.marketId, t.slug),
  }),
);

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    competitionId: integer('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    homeTeamId: integer('home_team_id')
      .notNull()
      .references(() => teams.id),
    awayTeamId: integer('away_team_id')
      .notNull()
      .references(() => teams.id),
    kickoffUtc: timestamp('kickoff_utc', { withTimezone: true }).notNull(),
    status: eventStatusEnum('status').default('scheduled').notNull(),
    externalIds: jsonb('external_ids').$type<Record<string, string>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxKickoff: index('idx_events_kickoff').on(t.kickoffUtc),
    idxCompetitionKickoff: index('idx_events_competition_kickoff').on(t.competitionId, t.kickoffUtc),
    uniqNatural: uniqueIndex('uniq_event_natural').on(
      t.competitionId,
      t.homeTeamId,
      t.awayTeamId,
      t.kickoffUtc,
    ),
  }),
);

// Time-series: candidate for TimescaleDB hypertable.
// NOTE: migration adds `SELECT create_hypertable('odds_snapshots', 'taken_at')` in a follow-up SQL.
export const oddsSnapshots = pgTable(
  'odds_snapshots',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    marketId: integer('market_id')
      .notNull()
      .references(() => markets.id),
    selectionId: integer('selection_id')
      .notNull()
      .references(() => selections.id),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id),
    odd: doublePrecision('odd').notNull(),
    isInPlay: boolean('is_in_play').default(false).notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.takenAt] }),
    idxLookup: index('idx_odds_lookup').on(t.eventId, t.marketId, t.selectionId, t.bookId, t.takenAt),
    idxEventTime: index('idx_odds_event_time').on(t.eventId, t.takenAt),
  }),
);

export const volumesSnapshots = pgTable(
  'volumes_snapshots',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    marketId: integer('market_id')
      .notNull()
      .references(() => markets.id),
    selectionId: integer('selection_id')
      .notNull()
      .references(() => selections.id),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id),
    matchedVolume: doublePrecision('matched_volume'),
    backBest: doublePrecision('back_best'),
    layBest: doublePrecision('lay_best'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.takenAt] }),
    idxVolLookup: index('idx_volumes_lookup').on(t.eventId, t.marketId, t.selectionId, t.bookId, t.takenAt),
  }),
);

export const signals = pgTable(
  'signals',
  {
    id: serial('id').primaryKey(),
    type: signalTypeEnum('type').notNull(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    marketId: integer('market_id').references(() => markets.id),
    selectionId: integer('selection_id').references(() => selections.id),
    edge: doublePrecision('edge').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: signalStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    idxCreated: index('idx_signals_created').on(t.createdAt),
    idxTypeStatus: index('idx_signals_type_status').on(t.type, t.status),
    idxEvent: index('idx_signals_event').on(t.eventId),
  }),
);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').default('admin').notNull(),
  telegramChatId: varchar('telegram_chat_id', { length: 64 }),
  bankrollEur: doublePrecision('bankroll_eur').default(500).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const signalRules = pgTable('signal_rules', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filter: jsonb('filter').$type<Record<string, unknown>>().default({}).notNull(),
  thresholdEdge: doublePrecision('threshold_edge').default(0.03).notNull(),
  channels: jsonb('channels').$type<Array<'telegram' | 'email' | 'web'>>().default(['web']).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    signalId: integer('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    ruleId: integer('rule_id').references(() => signalRules.id, { onDelete: 'set null' }),
    channel: varchar('channel', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxSignal: index('idx_notifications_signal').on(t.signalId),
  }),
);

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: serial('id').primaryKey(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    itemsFetched: integer('items_fetched').default(0).notNull(),
    itemsInserted: integer('items_inserted').default(0).notNull(),
    errorsCount: integer('errors_count').default(0).notNull(),
    status: ingestionStatusEnum('status').default('running').notNull(),
    note: text('note'),
  },
  (t) => ({
    idxBookStarted: index('idx_ingestion_book_started').on(t.bookId, t.startedAt),
  }),
);

export const eventLiveStates = pgTable(
  'event_live_states',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    takenAt: timestamp('taken_at', { withTimezone: true }).defaultNow().notNull(),
    homeGoals: integer('home_goals'),
    awayGoals: integer('away_goals'),
    elapsedMin: integer('elapsed_min'),
    status: text('status'),
    redCardsHome: integer('red_cards_home').default(0),
    redCardsAway: integer('red_cards_away').default(0),
    raw: jsonb('raw'),
  },
  (t) => ({
    idxEvTime: index('idx_els_event_time').on(t.eventId, t.takenAt),
  }),
);

export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mappingReview = pgTable('mapping_review', {
  id: serial('id').primaryKey(),
  entityType: varchar('entity_type', { length: 32 }).notNull(), // team | event | market
  sourceBookId: integer('source_book_id').references(() => books.id),
  sourceValue: text('source_value').notNull(),
  candidates: jsonb('candidates').$type<Array<{ id: number; score: number; name: string }>>().default([]).notNull(),
  status: mappingStatusEnum('status').default('pending').notNull(),
  resolvedToId: integer('resolved_to_id'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
