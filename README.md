# Pol.is Whitelabel

Pol.is Whitelabel is a fork of [Pol.is](https://github.com/compdemocracy/polis). Pol.is is
a system for understanding what large groups of people think about an issue. Pol.is Whitelabel is a pared down version of Pol.is with the goals of separating out deployment code from application code, make the system more configurable and refactoring to make feature development more straightforward.

## Key differences from Pol.is

The following things are different:

* Heroku config removed
* Bundlewatch removed
* Maxmind integration removed
* Stripe integration removed
* Intercom integration removed
* NGinx config removed
* Caddy used in place of NGinx (note this may be changed soon)
* Project runs Node 18 (with the exception of `server` on Ubuntu)
* Lots of vulnerable dependencies updated
* Database setup has moved into its own directory
* Started work reducing the file sizes
* Working developer environment documented
* 'One-click' Docker build and deployment implemented
* Basic performance tests included (note this may get migrated out to deployment repo soon)

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
