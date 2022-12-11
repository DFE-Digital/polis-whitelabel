# Polis Admin Console

This is the front-end code for the administrators.

## Dependencies

* node `18.12.1`
* npm `8.19.2`

## Setup

```sh
n 18.12.1
npm install
cp polis.config.template.js polis.config.js
npm run build:prod
```

From here go to `file-server` and run `make` to copy the built files across.

You can run `npm run build:dev` to get an unminified version which makes for easier in-browser debugging.


## Common Problems

If you having troubles with npm dependencies try run the commands below:

```sh
npm cache clear
npm install
```

## Running Application

```sh
nvm use 14.14.0
npm start
```

## Running Tests

We aspire to use the Jest Testing Framework. We welcome contributors to help us write tests!

```sh
# Doesn't work right now. Will need to reinstall jest.
npm test
```

## Building for Production

To build static assets into `dist/` for a production deployment, run

```sh
npm run build:prod
```

Deployment is currently performed via Docker, and so no other deployment scripts are provided.
