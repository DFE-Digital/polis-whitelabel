FROM --platform=linux/amd64 docker.io/node:18.12.1-alpine3.17

WORKDIR /app

RUN apk add postgresql-dev python3-dev build-base

RUN apk add --no-cache --virtual .build \
  g++ git make python3

COPY . .

# TODO get `npm ci` to work
RUN npm install
RUN apk del .build

RUN npm run build

EXPOSE 8000

CMD npm run start