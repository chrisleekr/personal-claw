## [1.2.9](https://github.com/chrisleekr/personal-claw/compare/v1.2.8...v1.2.9) (2026-04-08)


### Bug Fixes

* **research:** prevent test/placeholder issue creation ([99d39b3](https://github.com/chrisleekr/personal-claw/commit/99d39b30f1062b961f4fa20ea9c21f4d24eabee2)), closes [#33](https://github.com/chrisleekr/personal-claw/issues/33)

## [1.2.8](https://github.com/chrisleekr/personal-claw/compare/v1.2.7...v1.2.8) (2026-04-08)


### Bug Fixes

* **research:** increase timeout from 15 to 30 minutes for Opus deep research ([67eafe9](https://github.com/chrisleekr/personal-claw/commit/67eafe9c6cc989fe83e266a16130274a1d44d887))

## [1.2.7](https://github.com/chrisleekr/personal-claw/compare/v1.2.6...v1.2.7) (2026-04-08)


### Bug Fixes

* **research:** add schedule 2x daily, conventional commit titles, more areas ([fb5ed60](https://github.com/chrisleekr/personal-claw/commit/fb5ed6039b743ca7bfe9b5a03df6ad90f99415b6))

## [1.2.6](https://github.com/chrisleekr/personal-claw/compare/v1.2.5...v1.2.6) (2026-04-08)


### Bug Fixes

* **research:** add random area selection, fix Mermaid classDef syntax ([939c826](https://github.com/chrisleekr/personal-claw/commit/939c82607ac7bb892f68d5d29ded0d671202962e)), closes [#hex](https://github.com/chrisleekr/personal-claw/issues/hex) [#hex](https://github.com/chrisleekr/personal-claw/issues/hex)

## [1.2.5](https://github.com/chrisleekr/personal-claw/compare/v1.2.4...v1.2.5) (2026-04-08)


### Bug Fixes

* **research:** increase max-turns to 80 for thorough Opus research ([b2b997a](https://github.com/chrisleekr/personal-claw/commit/b2b997a4249b535a0b9e53bcc6bc6888aa9f17b6))
* **research:** optimize prompt for turn efficiency and daily schedule ([cf71a1c](https://github.com/chrisleekr/personal-claw/commit/cf71a1c5a8fa7d1b0d68551b1a545beda499d1a1))

## [1.2.4](https://github.com/chrisleekr/personal-claw/compare/v1.2.3...v1.2.4) (2026-04-08)


### Bug Fixes

* **research:** increase max-turns from 20 to 40 for Opus deep research ([b16b18c](https://github.com/chrisleekr/personal-claw/commit/b16b18ccdd3b1398204383281b6f8577fc523ddc))

## [1.2.3](https://github.com/chrisleekr/personal-claw/compare/v1.2.2...v1.2.3) (2026-04-08)


### Bug Fixes

* **research:** use claude_code_oauth_token as action input, not env var ([776e2b7](https://github.com/chrisleekr/personal-claw/commit/776e2b7a22b3ce3f11217ab55b9f2959149f8513))
* **research:** use OAuth token and Opus model instead of API key and Sonnet ([ce0289f](https://github.com/chrisleekr/personal-claw/commit/ce0289f8118b818f6bed5345aed9276ae551ebb8))

## [1.2.2](https://github.com/chrisleekr/personal-claw/compare/v1.2.1...v1.2.2) (2026-04-08)


### Bug Fixes

* **research:** remove track_progress unsupported for schedule/workflow_dispatch ([d78eab5](https://github.com/chrisleekr/personal-claw/commit/d78eab549ac208f6d164b8fadbbdfd99e796352f))
* **security:** harden authentication and authorization across WebSocket, approval gateway, and CLI tools ([#24](https://github.com/chrisleekr/personal-claw/issues/24)) ([24ed4b0](https://github.com/chrisleekr/personal-claw/commit/24ed4b0ec64ba8cb9917ec4cc999dbed989d4900))

## [1.2.1](https://github.com/chrisleekr/personal-claw/compare/v1.2.0...v1.2.1) (2026-04-07)


### Bug Fixes

* **sandbox:** harden command allowlist and enforce sandbox isolation ([#23](https://github.com/chrisleekr/personal-claw/issues/23)) ([f0c8ed4](https://github.com/chrisleekr/personal-claw/commit/f0c8ed428c9f7d32998cb17ced0ddb39e81f97d1))

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
