# polis-server

The server part of polis, written in TypeScript, compiles to JavaScript.

## Dependencies

* node `11.15.0`
* npm `7.0.15`

## Setup

1. Create .envrc file off template:

```sh
cp .envrc.example .envrc
```

2. Install apropriate node version:

```sh
n 11.15.0
```

3. Install depedencies and build assets:

```sh
npm install
npm run build
```

4a. Start development auto-reload server:

```sh
npm run dev
```

4b. Start production server:

```sh
npm start
```

## Enable translation API

Create a developer account on Google Cloud ([console.cloud.google.com](https://console.cloud.google.com)) and follow the instructions there to setup a 'service principal' for your pol.is instance.

You can generate a JSON file using the tutorial which has the key and other metadata required for the translation API. Copy this into `google-translate-key.json` and make sure the `GOOGLE_APPLICATION_CREDENTIALS` is set appropriately and `SHOULD_USE_TRANSLATION_API` is set to a truthy value.