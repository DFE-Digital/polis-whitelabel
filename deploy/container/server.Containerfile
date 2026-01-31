
FROM docker.io/node:24.11.1-alpine3.22

WORKDIR /app

RUN apk add postgresql-dev python3-dev build-base

RUN apk add --no-cache --virtual .build \
  g++ git make python3

COPY package*.json .

RUN npm ci

COPY . .

RUN apk del .build

RUN npm run build

EXPOSE 8000

CMD npm run start