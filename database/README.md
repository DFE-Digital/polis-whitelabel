# polis-database

PostgreSQL configuration and setup.

## Dependencies

* postgresql `13.0`

## Setup

1. Create new database:

```sh
createdb polis
```

2. Connect to the new database:

```sh
cd database/  # if not already
psql
```

3. Run all migrations in its shell:

```
\connect polis
\i migrations/000000_initial.sql
\i migrations/000001_update_pwreset_table.sql
\i migrations/000002_add_xid_constraint.sql
```
