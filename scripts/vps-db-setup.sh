#!/bin/bash
set -e

DB_PASSWORD="OddsRadar_2026_V9x"

sudo -u postgres psql <<SQL
DROP DATABASE IF EXISTS oddsradar;
DROP USER IF EXISTS oddsradar;
CREATE USER oddsradar WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE oddsradar OWNER oddsradar;
SQL

sudo -u postgres psql -d oddsradar <<SQL
GRANT ALL ON SCHEMA public TO oddsradar;
SQL

echo "DB created."
