# polis-client-report

This is the report conversation results part of polis.

## Dependencies

* node `11.15.0`
* npm `7.0.15`

## Setup

```sh
n 11.15.0
npm install -g npm@7.0
npm install
cp polis.config.template.js polis.config.js
npm run build
```

## Deployment

Deploy using the `npm run deploy:preprod` and `npm run deploy:prod`, as
appropriate.

Note that you will first have to copy over the `polis.config.template.js` file
to `polis.config.js`, and edit appropriately. In particular, here you can
specify the service url for the static build, as well as the uploader method
and s3 bucket information.

You will also need to have AWS credentials set up at
`.polis_s3_creds_client.json` if you are using S3 buckets for deployment (as
specified in `polis.config.js`; other option is scp to a static file server).

The credential file should be a json that looks more or less like:

```json
{
    "key": "AKIDFDCFDFDSDFDDSEWW",
    "secret": "dfkjw3DDfkjd902k39cjglkjs039i84kjccC"
}
```
