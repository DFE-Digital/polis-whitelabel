# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Features

- [#66](https://github.com/DFE-Digital/polis-whitelabel/issues/66) Improve language support including left-to-right, Farsi translation and improvements to German (Upstream Alignment)
- [#52](https://github.com/DFE-Digital/polis-whitelabel/issues/52) Example reverse-proxy for production
- [#11](https://github.com/DFE-Digital/polis-whitelabel/issues/11) Added Devcontainer based development environment
- [#29](https://github.com/DFE-Digital/polis-whitelabel/issues/29) Basic performance test scripts in JMeter
- [#13](https://github.com/DFE-Digital/polis-whitelabel/issues/13) Include configurable cookie notice and accessibility statement
- [#7](https://github.com/DFE-Digital/polis-whitelabel/issues/7) Developer workflow established and documented - based on the [suburb fork of pol.is](https://github.com/sirodoht/suburb/commit/6638e3078165c62c96a82f098737607bbb8848ee)

### Bugs

- [#76](https://github.com/DFE-Digital/polis-whitelabel/issues/76) Fix pull request template
- [#59](https://github.com/DFE-Digital/polis-whitelabel/issues/59) Remove server headers from example production configuration/Update devcontainer
- [#58](https://github.com/DFE-Digital/polis-whitelabel/issues/58) `polis-math` filling container with `errorconv.*.edn` files
- [#53](https://github.com/DFE-Digital/polis-whitelabel/issues/53) Fix missing `libpq-dev` dependency when building `server` in Devcontainer
- [#49](https://github.com/DFE-Digital/polis-whitelabel/issues/49) Updated/removed vulnerable math dependencies including AWS housekeeping functions
- [#48](https://github.com/DFE-Digital/polis-whitelabel/issues/48) Fix a XSS bug where HTML & Javascript can be dropped into description field
- [#45](https://github.com/DFE-Digital/polis-whitelabel/issues/45) Update `file-server` to update dependencies in Dockerfile
- [#41](https://github.com/DFE-Digital/polis-whitelabel/issues/39) Update `server` to run a new version of Node and update dependencies
- [#42](https://github.com/DFE-Digital/polis-whitelabel/issues/42) Fix to crash when voting anonymously and remove legacy IP logging
- [#39](https://github.com/DFE-Digital/polis-whitelabel/issues/39) Fix to #37 so that `file-server.Dockerfile` now builds with latest versions
- [#37](https://github.com/DFE-Digital/polis-whitelabel/issues/37) Migrated client-report from Gulp 3 to Webpack
- [#33](https://github.com/DFE-Digital/polis-whitelabel/issues/33) Fix e2e tests and establish contribution workflow
- [#30](https://github.com/DFE-Digital/polis-whitelabel/issues/30) Migrated client-admin from Gulp 3 to Webpack
- [#5](https://github.com/DFE-Digital/polis-whitelabel/issues/5) Restored Docker build process
- [#1](https://github.com/DFE-Digital/polis-whitelabel/issues/1) Fixed `authorUid is undefined` crash in `server`
- [#3](https://github.com/DFE-Digital/polis-whitelabel/issues/3) Fixed crash when `.headersJson` file not present for `file-server`

### Performance

- [#80](https://github.com/DFE-Digital/polis-whitelabel/issues/80) Reduce client-participation bundlesize by optimizing D3.

## Forked from [github.com/compdemocracy/polis/commit/52e983a](https://github.com/compdemocracy/polis/commit/52e983aef272c140a77a5b26ea6bf0ead9f8aece)
