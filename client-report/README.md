# polis-client-report

This is the report conversation results part of polis.

## Dependencies

* node `18.12.1`
* npm `8.19.2`

## Setup

```sh
n 18.12.1
npm install
npm run build:prod
```

From here go to `file-server` and run `make` to copy the built files across.

You can run `npm run build:dev` to get an unminified version which makes for easier in-browser debugging.
