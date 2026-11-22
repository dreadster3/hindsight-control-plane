# Changelog

## [0.2.1](https://github.com/dreadster3/hindsight-control-plane/compare/v0.2.0...v0.2.1) (2026-11-22)


### Bug Fixes

* **security:** 405 method gate, envoy login ip ([#25](https://github.com/dreadster3/hindsight-control-plane/issues/25)) ([d510d5e](https://github.com/dreadster3/hindsight-control-plane/commit/d510d5e38e0b95b0ee1e661fa71222ce6bf3a214))

## [0.2.0](https://github.com/dreadster3/hindsight-control-plane/compare/v0.1.2...v0.2.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* **security:** pentest hardening ([#23](https://github.com/dreadster3/hindsight-control-plane/issues/23))

### Bug Fixes

* **security:** pentest hardening ([#23](https://github.com/dreadster3/hindsight-control-plane/issues/23)) ([0be249d](https://github.com/dreadster3/hindsight-control-plane/commit/0be249d818d1397983dfe453336a3a240af647f9))

## [0.1.2](https://github.com/dreadster3/hindsight-control-plane/compare/v0.1.1...v0.1.2) (2026-11-19)


### Bug Fixes

* **auth:** clear session cookie with Secure attr ([#21](https://github.com/dreadster3/hindsight-control-plane/issues/21)) ([1a7aad9](https://github.com/dreadster3/hindsight-control-plane/commit/1a7aad976af40bb09e9dd768e4c6c39c051ab860))
* **auth:** request offline_access for refresh ([#20](https://github.com/dreadster3/hindsight-control-plane/issues/20)) ([59067e1](https://github.com/dreadster3/hindsight-control-plane/commit/59067e106572f71b571499c0af426eac1f8d1642))

## [0.1.1](https://github.com/dreadster3/hindsight-control-plane/compare/v0.1.0...v0.1.1) (2026-11-17)


### Bug Fixes

* **auth:** clear session on failed token refresh ([#18](https://github.com/dreadster3/hindsight-control-plane/issues/18)) ([8683761](https://github.com/dreadster3/hindsight-control-plane/commit/86837617796e92d740f634d27171e6e9ecad0bef))
* **cli:** honor HINDSIGHT_CP_HOSTNAME/PORT ([#16](https://github.com/dreadster3/hindsight-control-plane/issues/16)) ([2152d82](https://github.com/dreadster3/hindsight-control-plane/commit/2152d82b132d1260713d1a4bd5e257b94e4ffd79))

## 0.1.0 (2026-11-15)


### Features

* **auth:** add OIDC login with per-user bank scoping ([5fcd813](https://github.com/dreadster3/hindsight-control-plane/commit/5fcd81347878a092cf84095d451d0dd2873d6d6f))
* **ci:** add release-please and GHCR docker publishing ([b19d60d](https://github.com/dreadster3/hindsight-control-plane/commit/b19d60d1fde054a3eff4daf32c930c6e31103b64))
* **ui:** show header logout for OIDC sessions ([3caadfb](https://github.com/dreadster3/hindsight-control-plane/commit/3caadfb3586a732ecf059bdf7c54cf04b130503b))


### Bug Fixes

* **api:** probe /v1/version and degrade gracefully in version route ([294d0e0](https://github.com/dreadster3/hindsight-control-plane/commit/294d0e0cbd37c409af8d222a8767f399261c63c5))
* **ci:** build vendored SDK before typecheck and test ([85b44b8](https://github.com/dreadster3/hindsight-control-plane/commit/85b44b8453d2171e423bc4d848fbfeed5fe602c4))
* **ci:** correct fabricated actions/setup-node v7.1.0 SHA ([ceb46a8](https://github.com/dreadster3/hindsight-control-plane/commit/ceb46a83e37854761d45cacb4b092d72eccf23cd))
* **ci:** set initial-version 0.1.0 so first release isn't 1.0.0 ([c9cb766](https://github.com/dreadster3/hindsight-control-plane/commit/c9cb766de13a170b0c713d5864860a4c0da5c91b))
* **ci:** use real actions/setup-node v7.1.0 SHA 949feb24 ([534feb7](https://github.com/dreadster3/hindsight-control-plane/commit/534feb76c9dd44a6f61cb0912265a476bcbb288e))
* **vendor:** pin SDK types to node for hermetic dts builds ([7238870](https://github.com/dreadster3/hindsight-control-plane/commit/72388700840b492d1b7456b71b8396844a44881c))
