
FROM --platform=linux/amd64 docker.io/node:18.12.1-alpine AS client-base

RUN apk add git --no-cache

# polis-client-admin
FROM client-base AS client-admin

WORKDIR /client-admin/app

COPY client-admin/. .
COPY file-server/polis.config.js polis.config.js

RUN npm install

RUN npm run build:prod


# polis-client-participation
FROM client-base AS client-participation

WORKDIR /client-participation/app

COPY client-participation/. .
COPY file-server/polis.config.js polis.config.js

RUN npm install

RUN npm run build:prod


# polis-client-report
FROM client-base AS client-report

WORKDIR /client-report/app

COPY client-report/. .

# This should be working with `npm ci`, but isn't; Need to debug
RUN npm install

RUN npm run build:prod



# actual file server component
FROM client-base

WORKDIR /app

COPY file-server/package*.json ./

RUN npm install

COPY file-server/fs_config.template.json fs_config.json
# If fs_config.json exists, will override the template here.
COPY file-server/. .

# use the multi-stage builds above to copy out the resources
# RUN mkdir /app/build
COPY --from=client-admin         /client-admin/app/dist/         /app/build
COPY --from=client-participation /client-participation/app/dist/  /app/build
COPY --from=client-report        /client-report/app/dist/        /app/build

EXPOSE 8080

CMD node --max_old_space_size=400 --gc_interval=100 --harmony app.js


