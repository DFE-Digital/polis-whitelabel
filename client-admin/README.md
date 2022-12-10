# polis-client-admin

Polis Admin Console.

## Dependencies

* node `11.15.0`
* npm `7.0.15`

## Setup

```sh
n 11.15.0
npm install -g npm@7.0
npm install
```

## Common Problems

If you having troubles with npm dependencies try run the commands below:

```sh
npm cache clear
npm install
```

## Building and Deploying for Production

To build static assets for a production deployment, run:

```sh
gulp dist
```

As a convenience, the `npm deploy:prod` is provided for deploying to AWS S3 or
via SCP to a static file server. For S3 deployment, place your AWS credentials
in a JSON file at `.polis_s3_creds_client.json` that looks like this:

```json
{"key": "XXXXXXX", "secret": "YYYYYYY"}
```

## QA Steps

### Static, outide

- User can see home page at `/home`
- User is redirected to `/home` if not logged in
- User can sign in at `/signin`
- User can reset password at `/pwreset`
- User can `/createuser` and make a new account, login
- User can see `/privacy` policy
- User can see `/tos`
- User can see `/cookies`
- User can see `/accessibility`

### After login

- User can get `/integrate` embed code for whole site
- User can see social linkage at `/account`
- User can see all of their conversations

## Icons from the Noun Project

* Checklist by David Courey from the Noun Project
* AI by mungang kim from the Noun Project
* Science by Akriti Bhusal from the Noun Project
* Success File by Ben Davis from the Noun Project
