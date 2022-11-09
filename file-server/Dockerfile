ARG TAG=dev

# polis-client-admin
FROM --platform=linux/amd64 docker.io/node:11.15.0-alpine AS client-base

# Fixes Bug in Alpine < 12.4.0 https://stackoverflow.com/a/52196681/199
RUN npm config set unsafe-perm true

RUN apk add git g++ make python openssh --no-cache

# Upgrade npm v6.7.0 -> v6.9.2 to alias multiple pkg versions.
# See: https://stackoverflow.com/a/56134858/504018
RUN npm install -g npm@6.9.2

# polis-client-admin
FROM client-base AS client-admin

WORKDIR /client-admin/app

COPY client-admin/. .
COPY file-server/polis.config.js polis.config.js

RUN npm install

ARG GIT_HASH
RUN npm run deploy:prod



# polis-client-participation
# # Gulp v3 stops us from upgrading beyond Node v11
FROM client-base AS client-participation

WORKDIR /client-participation/app

# Allow global npm installs in Docker
RUN npm config set unsafe-perm true

COPY client-participation/. .
COPY file-server/polis.config.js polis.config.js

# It would be nice if this was ci, but misbehaving for some reason
RUN npm ci

ARG GIT_HASH
ARG BABEL_ENV=production

RUN npm run deploy:prod


# polis-client-report
# Gulp v3 stops us from upgrading beyond Node v11
FROM client-base AS client-report

WORKDIR /client-report/app

COPY client-report/. .
COPY file-server/polis.config.js polis.config.js

# This should be working with `npm ci`, but isn't; Need to debug
RUN npm install

ARG GIT_HASH
RUN npm run deploy:prod



# actual file server component
FROM --platform=linux/amd64 docker.io/node:16.9.0-alpine

WORKDIR /app

COPY file-server/package*.json ./

RUN npm ci

COPY file-server/fs_config.template.json fs_config.json
# If fs_config.json exists, will override the template here.
COPY file-server/. .

# use the multi-stage builds above to copy out the resources
# RUN mkdir /app/build
COPY --from=client-admin         /client-admin/app/build/         /app/build
COPY --from=client-participation /client-participation/app/build/ /app/build
COPY --from=client-report        /client-report/app/build/        /app/build

EXPOSE 8080

CMD node --max_old_space_size=400 --gc_interval=100 --harmony app.js


