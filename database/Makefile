.PHONY: init
init:
	$(info Initialise PostgreSQL database files)
	PGDATA=postgres-data/ pg_ctl init
	PGDATA=postgres-data/ pg_ctl start
	createuser polis
	psql -U postgres -c "ALTER USER polis CREATEDB;"
	psql -U polis -d postgres -c "CREATE DATABASE polis;"
	psql -U polis -c "ALTER USER polis WITH PASSWORD 'polis';"
	psql -U polis -f migrations/000000_initial.sql
	psql -U polis -f migrations/000001_update_pwreset_table.sql
	psql -U polis -f migrations/000002_add_xid_constraint.sql

.PHONY: start
start:
	$(info Start PostgreSQL)
	PGDATA=postgres-data/ pg_ctl start

.PHONY: stop
stop:
	$(info Stop PostgreSQL)
	PGDATA=postgres-data/ pg_ctl stop
