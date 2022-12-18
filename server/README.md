# polis-server

The server part of polis, written in TypeScript, compiles to JavaScript.

## Dependencies

> **Warning** Ubuntu 20.04 LTS will not work with Node >17 as it is compiled against OpenSSL 3.0 so use 16.19.0 instead.

> **Warning** Ubuntu 22.04 LTS has a voting bug with any version of Node which is currently under investigation.

* node `16.19.0`

## Setup

1. Create .envrc file off template:

```sh
cp .envrc.example .envrc
```

2. Install appropriate node version:

```sh
n 16.19.0
```

3. Install dependencies and build assets:

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