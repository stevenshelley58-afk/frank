#!/usr/bin/env bash
# FRANK — database and role separation.
#
# Runs ONCE, on an empty data directory, from the official entrypoint.
#
# Spec: FRANK-§16.2 "Temporal | Separate database and worker processes" and "their
#       product-specific database schemas are not imported into FRANK domain modules";
#       FRANK-§11.4 (database separation); FRANK-§16.4 "No environment shares credentials
#       or writable databases with another" — applied here at service granularity too;
#       FRANK-§15.2 "Workload identities for services; no shared human credentials".
#
# Result:
#   frank                      owner: frank             FRANK canonical domain + outbox + audit
#   frank_temporal             owner: frank_temporal    Temporal persistence
#   frank_temporal_visibility  owner: frank_temporal    Temporal visibility
#   frank_authentik            owner: frank_authentik   Authentik
#
# Each non-owner role is REVOKEd from every database it does not own, so a compromise of the
# Temporal or Authentik credential cannot read FRANK domain data.
#
# No secret is written to disk or to the log by this script: passwords arrive as environment
# variables and are passed to psql as quoted psql variables, never interpolated into SQL text.

set -euo pipefail

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${FRANK_TEMPORAL_DB_USER:?}"
: "${FRANK_TEMPORAL_DB_PASSWORD:?}"
: "${FRANK_TEMPORAL_DB_NAME:?}"
: "${FRANK_TEMPORAL_VISIBILITY_DB_NAME:?}"
: "${FRANK_AUTHENTIK_DB_USER:?}"
: "${FRANK_AUTHENTIK_DB_PASSWORD:?}"
: "${FRANK_AUTHENTIK_DB_NAME:?}"

echo "[frank-initdb] creating service roles and separate databases"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -v temporal_user="${FRANK_TEMPORAL_DB_USER}" \
  -v temporal_password="${FRANK_TEMPORAL_DB_PASSWORD}" \
  -v authentik_user="${FRANK_AUTHENTIK_DB_USER}" \
  -v authentik_password="${FRANK_AUTHENTIK_DB_PASSWORD}" <<-'EOSQL'
	-- Workload identities. NOSUPERUSER/NOCREATEDB/NOCREATEROLE is the point: Temporal runs
	-- with SKIP_DB_CREATE=true precisely so it never needs CREATEDB.
	CREATE ROLE :"temporal_user"  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
	    PASSWORD :'temporal_password';
	CREATE ROLE :"authentik_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
	    PASSWORD :'authentik_password';
EOSQL

# CREATE DATABASE cannot run inside a transaction block, so each is its own statement.
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "CREATE DATABASE \"${FRANK_TEMPORAL_DB_NAME}\" OWNER \"${FRANK_TEMPORAL_DB_USER}\" ENCODING 'UTF8';"
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "CREATE DATABASE \"${FRANK_TEMPORAL_VISIBILITY_DB_NAME}\" OWNER \"${FRANK_TEMPORAL_DB_USER}\" ENCODING 'UTF8';"
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "CREATE DATABASE \"${FRANK_AUTHENTIK_DB_NAME}\" OWNER \"${FRANK_AUTHENTIK_DB_USER}\" ENCODING 'UTF8';"

echo "[frank-initdb] revoking cross-service access"

# Default PUBLIC CONNECT on every database is removed; access is granted to exactly one
# workload identity per database.
for pair in \
  "${POSTGRES_DB}:${POSTGRES_USER}" \
  "${FRANK_TEMPORAL_DB_NAME}:${FRANK_TEMPORAL_DB_USER}" \
  "${FRANK_TEMPORAL_VISIBILITY_DB_NAME}:${FRANK_TEMPORAL_DB_USER}" \
  "${FRANK_AUTHENTIK_DB_NAME}:${FRANK_AUTHENTIK_DB_USER}"
do
  db="${pair%%:*}"
  owner="${pair##*:}"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
    -c "REVOKE ALL ON DATABASE \"${db}\" FROM PUBLIC;" \
    -c "GRANT ALL ON DATABASE \"${db}\" TO \"${owner}\";"
  # PostgreSQL 15+ already removes CREATE on public from PUBLIC; assert it rather than
  # assume it, and hand the schema to the owning workload identity.
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${db}" \
    -c "REVOKE ALL ON SCHEMA public FROM PUBLIC;" \
    -c "ALTER SCHEMA public OWNER TO \"${owner}\";" \
    -c "GRANT ALL ON SCHEMA public TO \"${owner}\";"
done

echo "[frank-initdb] databases ready: ${POSTGRES_DB}, ${FRANK_TEMPORAL_DB_NAME}, ${FRANK_TEMPORAL_VISIBILITY_DB_NAME}, ${FRANK_AUTHENTIK_DB_NAME}"
