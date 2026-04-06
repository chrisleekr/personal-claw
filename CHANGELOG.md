# [1.2.0](https://github.com/chrisleekr/personal-claw/compare/v1.1.0...v1.2.0) (2026-04-06)


### Features

* **memory:** add Ollama as embedding provider ([#22](https://github.com/chrisleekr/personal-claw/issues/22)) ([886e982](https://github.com/chrisleekr/personal-claw/commit/886e98268ffac4391bae54184c06b77c9938c8a1))

# [1.1.0](https://github.com/chrisleekr/personal-claw/compare/v1.0.2...v1.1.0) (2026-04-06)


### Bug Fixes

* **sandbox:** prevent host env var leakage in sandbox execution ([#21](https://github.com/chrisleekr/personal-claw/issues/21)) ([89f4822](https://github.com/chrisleekr/personal-claw/commit/89f4822b87f4f10ac294ca1a4397d41fa052d270))


### Features

* setup SpecKit integration and improve code quality ([#20](https://github.com/chrisleekr/personal-claw/issues/20)) ([6b10b8a](https://github.com/chrisleekr/personal-claw/commit/6b10b8ac13e9ad8ce9c3d4fb5ec0fed9e16a42bc))

## [1.0.2](https://github.com/chrisleekr/personal-claw/compare/v1.0.1...v1.0.2) (2026-04-03)


### Bug Fixes

* **mcp:** prevent arbitrary command execution in stdio transport ([#19](https://github.com/chrisleekr/personal-claw/issues/19)) ([528fd5b](https://github.com/chrisleekr/personal-claw/commit/528fd5b7d5fbe3d04a64ff2a49d13270e123a877))

## [1.0.1](https://github.com/chrisleekr/personal-claw/compare/v1.0.0...v1.0.1) (2026-04-02)


### Bug Fixes

* auth middleware fails closed when API_SECRET is unset ([#18](https://github.com/chrisleekr/personal-claw/issues/18)) ([2a71594](https://github.com/chrisleekr/personal-claw/commit/2a715948a88c7771d733b71e972c0c82b6c7d9c6))

# 1.0.0 (2026-03-06)


### Bug Fixes

* **ci:** consolidate CI workflows and resolve type check failures ([df06655](https://github.com/chrisleekr/personal-claw/commit/df0665500483fd320ad3f857eee7f7ac94b0f837))
* **ci:** isolate semantic-release npm install from Bun workspace ([#3](https://github.com/chrisleekr/personal-claw/issues/3)) ([2eeda69](https://github.com/chrisleekr/personal-claw/commit/2eeda69d4478e1fd6d464e87a53c6ebf4a43d03e))
* **ci:** resolve turbo command not found in type check step ([7cc99e7](https://github.com/chrisleekr/personal-claw/commit/7cc99e714d76119f48c56db5d570f7aa1ae4081a))
* **ci:** resolve type check and test failures in CI pipeline ([cb8c8c4](https://github.com/chrisleekr/personal-claw/commit/cb8c8c46048fb12ec39ecfe190b0044e8801ea34)), closes [oven-sh/bun#12823](https://github.com/oven-sh/bun/issues/12823)
* **db:** correct embedding dimension comment from 1536 to 1024 ([320968f](https://github.com/chrisleekr/personal-claw/commit/320968f19294f14a52a5c065a825401a7872a031))
