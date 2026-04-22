CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'in_play', 'finished', 'postponed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mapping_status" AS ENUM('pending', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('active', 'expired', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."signal_type" AS ENUM('arb', 'value', 'steam');--> statement-breakpoint
CREATE TYPE "public"."source_tier" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"country" varchar(3),
	"tier" "source_tier" DEFAULT 'medium' NOT NULL,
	"is_sharp" boolean DEFAULT false NOT NULL,
	"rate_limit_rpm" integer DEFAULT 60 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"country" varchar(3),
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"competition_id" integer NOT NULL,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"kickoff_utc" timestamp with time zone NOT NULL,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_fetched" integer DEFAULT 0 NOT NULL,
	"items_inserted" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "mapping_review" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"source_book_id" integer,
	"source_value" text NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "mapping_status" DEFAULT 'pending' NOT NULL,
	"resolved_to_id" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"rule_id" integer,
	"channel" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds_snapshots" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "odds_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"taken_at" timestamp with time zone NOT NULL,
	"event_id" integer NOT NULL,
	"market_id" integer NOT NULL,
	"selection_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"odd" double precision NOT NULL,
	"is_in_play" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	CONSTRAINT "odds_snapshots_id_taken_at_pk" PRIMARY KEY("id","taken_at")
);
--> statement-breakpoint
CREATE TABLE "selections" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"threshold_edge" double precision DEFAULT 0.03 NOT NULL,
	"channels" jsonb DEFAULT '["web"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "signal_type" NOT NULL,
	"event_id" integer NOT NULL,
	"market_id" integer,
	"selection_id" integer,
	"edge" double precision NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "signal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "team_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"alias" text NOT NULL,
	"source_book_id" integer,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer NOT NULL,
	"name_canonical" text NOT NULL,
	"country" varchar(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"telegram_chat_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "volumes_snapshots" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "volumes_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"taken_at" timestamp with time zone NOT NULL,
	"event_id" integer NOT NULL,
	"market_id" integer NOT NULL,
	"selection_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"matched_volume" double precision,
	"back_best" double precision,
	"lay_best" double precision,
	CONSTRAINT "volumes_snapshots_id_taken_at_pk" PRIMARY KEY("id","taken_at")
);
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_review" ADD CONSTRAINT "mapping_review_source_book_id_books_id_fk" FOREIGN KEY ("source_book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_signal_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."signal_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_selection_id_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_rules" ADD CONSTRAINT "signal_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_selection_id_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes_snapshots" ADD CONSTRAINT "volumes_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes_snapshots" ADD CONSTRAINT "volumes_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes_snapshots" ADD CONSTRAINT "volumes_snapshots_selection_id_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes_snapshots" ADD CONSTRAINT "volumes_snapshots_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_competition_sport_slug" ON "competitions" USING btree ("sport_id","slug");--> statement-breakpoint
CREATE INDEX "idx_events_kickoff" ON "events" USING btree ("kickoff_utc");--> statement-breakpoint
CREATE INDEX "idx_events_competition_kickoff" ON "events" USING btree ("competition_id","kickoff_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_event_natural" ON "events" USING btree ("competition_id","home_team_id","away_team_id","kickoff_utc");--> statement-breakpoint
CREATE INDEX "idx_ingestion_book_started" ON "ingestion_runs" USING btree ("book_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_signal" ON "notifications" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "idx_odds_lookup" ON "odds_snapshots" USING btree ("event_id","market_id","selection_id","book_id","taken_at");--> statement-breakpoint
CREATE INDEX "idx_odds_event_time" ON "odds_snapshots" USING btree ("event_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_selection_market_slug" ON "selections" USING btree ("market_id","slug");--> statement-breakpoint
CREATE INDEX "idx_signals_created" ON "signals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_signals_type_status" ON "signals" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "idx_signals_event" ON "signals" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_team_alias" ON "team_aliases" USING btree ("team_id","alias");--> statement-breakpoint
CREATE INDEX "idx_team_alias_trgm" ON "team_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "idx_teams_sport_name" ON "teams" USING btree ("sport_id","name_canonical");--> statement-breakpoint
CREATE INDEX "idx_volumes_lookup" ON "volumes_snapshots" USING btree ("event_id","market_id","selection_id","book_id","taken_at");