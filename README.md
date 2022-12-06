# Polis Whitelabel

Polis Whitelabel is a fork of [Polis](https://github.com/compdemocracy/polis). Polis is
a system for understanding what large groups of people think about an issue.

## Differences from Polis

Polis Whitelabel is a pared down version of Pol.is.

The following things are different:

* Heroku config removed
* Bundlewatch removed
* nginx config removed
* Caddy config added
* All components now use a single Node.js version
* e2e tests upgraded to latest Node.js LTS version
* e2e cypress updated to v10
* Stripe integration removed
* Database setup has moved into its own directory
* Separate server.ts into handlers.ts and helpers.ts
* Intercom removed

## Deployment

See [Server Playbook](server-playbook.md).

## Architecture

* `database/` is migrations and config for the PostgreSQL database
* `server/` is the main Node.js server
    * connects to: database
    * connects to: file-server
* `math/` is the statistics service in Clojure
    * connects to: server
    * connects to: database
* `file-server/` is the service that serves the JS frontend apps:
    * `client-admin/` is for conversation administrators
    * `client-participation/` is for end-users
    * `client-report/` is for detailed analytics reports
* `caddy/` is configs for Caddy server, used as reverse proxy
    * connects to: server

## License

[AGPLv3 with additional permission under section 7](LICENSE)
