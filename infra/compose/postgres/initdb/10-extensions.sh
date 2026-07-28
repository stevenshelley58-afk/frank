#!/usr/bin/env bash
# FRANK — extension baseline.
#
# Spec: FRANK-§16.2 "Canonical database | PostgreSQL | Extensions limited and pinned;
#       pgvector for baseline semantic index"; FRANK-§16.2 "Knowledge projection |
#       PostgreSQL/pgvector baseline ... no graph engine promoted before eval";
#       FRANK-§15.8 (pin everything).
#
# The allowed extension set is exactly three, and only in the FRANK domain database:
#   vector              pgvector — baseline semantic index and knowledge projection
#   pgcrypto            digest/HMAC for content addressing and audit chaining (§11.5)
#   pg_stat_statements  capacity evidence for §16.6 "measure before resizing"
#
# Temporal and Authentik databases get NO extensions: their schemas are managed by their own
# migrations and §16.2 forbids importing third-party schemas into FRANK domain modules.
#
# Adding an extension here is a change-controlled act (§0.2): it becomes a core dependency of
# the canonical database and needs an ADR, a migration and a rollback path.

set -euo pipefail

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"

echo "[frank-initdb] installing pinned extension set into ${POSTGRES_DB}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-'EOSQL'
	CREATE EXTENSION IF NOT EXISTS vector;
	CREATE EXTENSION IF NOT EXISTS pgcrypto;
	CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

	-- Record what is installed so a restore can be checked against it (§16.7 recovery
	-- manifest: "configuration commit" and store-level verification).
	DO $$
	DECLARE
	    unexpected text;
	BEGIN
	    SELECT string_agg(extname, ', ' ORDER BY extname) INTO unexpected
	    FROM pg_extension
	    WHERE extname NOT IN ('plpgsql', 'vector', 'pgcrypto', 'pg_stat_statements');

	    IF unexpected IS NOT NULL THEN
	        RAISE EXCEPTION 'FRANK-16.2 violation: unpinned extension(s) present: %', unexpected;
	    END IF;
	END
	$$;
EOSQL

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "SELECT extname, extversion FROM pg_extension ORDER BY extname;"

echo "[frank-initdb] extension baseline verified"
