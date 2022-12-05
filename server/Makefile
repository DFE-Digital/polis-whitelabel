.PHONY: pginit
pginit:
	$(info Initialising PostgreSQL database files)
	PGDATA=postgres-data/ pg_ctl init
	PGDATA=postgres-data/ pg_ctl start
	createuser polis
	psql -U postgres -c "ALTER USER polis CREATEDB;"
	psql -U polis -d postgres -c "CREATE DATABASE polis;"

.PHONY: pgstart
pgstart:
	$(info Start PostgreSQL)
	PGDATA=postgres-data/ pg_ctl start

.PHONY: pgstop
pgstop:
	$(info Stop PostgreSQL)
	PGDATA=postgres-data/ pg_ctl stop
