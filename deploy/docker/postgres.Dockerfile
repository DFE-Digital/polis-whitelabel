FROM --platform=linux/amd64 docker.io/postgres:13.4-alpine

# Used when no existing database on postgres volume, including first initialization.
# See: docs/deployment.md#database-migrations
# See: https://github.com/docker-library/docs/blob/master/postgres/README.md#initialization-scripts
COPY ./migrations/*.sql /docker-entrypoint-initdb.d/


