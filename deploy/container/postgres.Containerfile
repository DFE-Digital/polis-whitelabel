FROM docker.io/postgres:13.23-alpine3.21

# Used when no existing database on postgres volume, including first initialization.
# See: docs/deployment.md#database-migrations
# See: https://github.com/docker-library/docs/blob/master/postgres/README.md#initialization-scripts
COPY ./migrations/*.sql /docker-entrypoint-initdb.d/


