# Changelog

## [1.12.0](https://github.com/martinwichner/clispark/compare/v1.11.0...v1.12.0) (2026-07-19)


### Features

* add fun machine facts to whoami easter egg ([f05e4c1](https://github.com/martinwichner/clispark/commit/f05e4c110cc20f579156fbf35565a14fc0b6f4c2))

## [1.11.0](https://github.com/martinwichner/clispark/compare/v1.10.0...v1.11.0) (2026-07-18)


### Features

* add clispark whoami easter egg ([16c92e0](https://github.com/martinwichner/clispark/commit/16c92e079ff3353746c3bbd04fb9a1891d6d464d))

## [1.10.0](https://github.com/martinwichner/clispark/compare/v1.9.0...v1.10.0) (2026-07-18)


### Features

* add findPackageRoot utility and LanguagePack/RegistryChecker interfaces ([9977514](https://github.com/martinwichner/clispark/commit/9977514ce6480553435d68b63f5e51d82015d1cd))
* add language field to Manifest and buildManifest ([f3f2d41](https://github.com/martinwichner/clispark/commit/f3f2d410eee9606aa1b934da614b6d13bcc5182e))
* add nodeOclifPack and LANGUAGE_PACKS lookup ([485cf6e](https://github.com/martinwichner/clispark/commit/485cf6e07ce2886718bf48d41b4ccfd21b266306))
* add npm RegistryChecker, remove superseded registry.ts ([d425998](https://github.com/martinwichner/clispark/commit/d425998dc7ad20383d8b39597e57b2170388ab13))


### Bug Fixes

* add missing language field to Manifest test fixtures in node-oclif.test.ts and releasenotes.test.ts ([3b6444d](https://github.com/martinwichner/clispark/commit/3b6444d298ec88693011875f81d0ce10a2ee6965))
* update ci.yml's scaffold-smoke job to pass nodeOclifPack to scaffoldProject ([8b976e9](https://github.com/martinwichner/clispark/commit/8b976e92edacc7ec8e2fa7a4c5fc200a4b82bbbc))

## [1.9.0](https://github.com/martinwichner/clispark/compare/v1.8.1...v1.9.0) (2026-07-18)


### Features

* add node-oclif UpdateAdapter implementation ([3140a35](https://github.com/martinwichner/clispark/commit/3140a35b4ed941f70e84af6eac10da89fd0143d3))
* add UpdateAdapter interface for update-system decoupling ([9756971](https://github.com/martinwichner/clispark/commit/9756971737ee421dd249d403357dbbdc04755e6a))

## [1.8.1](https://github.com/martinwichner/clispark/compare/v1.8.0...v1.8.1) (2026-07-17)


### Bug Fixes

* composite action can't checkout itself - move checkout to job level ([bc35d4a](https://github.com/martinwichner/clispark/commit/bc35d4ac4b4cfdc241b53090e25f2b50b12a0890))

## [1.8.0](https://github.com/martinwichner/clispark/compare/v1.7.1...v1.8.0) (2026-07-17)


### Features

* **template:** demonstrate Flags via task list's --done flag ([f224f71](https://github.com/martinwichner/clispark/commit/f224f71b3fc2bf50a449b969d0caf6fe9d9bf8dd))

## [1.7.1](https://github.com/martinwichner/clispark/compare/v1.7.0...v1.7.1) (2026-07-17)


### Performance Improvements

* throttle log sweep and add fetch timeouts ([9edabda](https://github.com/martinwichner/clispark/commit/9edabda843935d08837aa64e70ddbc6a2db4817c))

## [1.7.0](https://github.com/martinwichner/clispark/compare/v1.6.2...v1.7.0) (2026-07-17)


### Features

* gate npm name-availability check behind publish intent ([e724410](https://github.com/martinwichner/clispark/commit/e72441042430690dbc5aea0dd66c119084099c0b))

## [1.6.2](https://github.com/martinwichner/clispark/compare/v1.6.1...v1.6.2) (2026-07-17)


### Bug Fixes

* generalize sensitive-key log redaction beyond registryUrl ([0b37ec4](https://github.com/martinwichner/clispark/commit/0b37ec4ae09d5b2e06773df8332a24f149f42dfb))

## [1.6.1](https://github.com/martinwichner/clispark/compare/v1.6.0...v1.6.1) (2026-07-17)


### Bug Fixes

* use rebase instead of squash for release-please PR auto-merge ([9345aee](https://github.com/martinwichner/clispark/commit/9345aee6117dedfb7e8555dfef59b95a5765a125))

## [1.6.0](https://github.com/martinwichner/clispark/compare/v1.5.0...v1.6.0) (2026-07-17)


### Features

* **template:** add usage examples to task commands' --help output ([7a91b44](https://github.com/martinwichner/clispark/commit/7a91b4492540a59b0b1eaee8c9376656d61f8a12))

## [1.5.0](https://github.com/martinwichner/clispark/compare/v1.4.0...v1.5.0) (2026-07-14)


### Features

* DEBUG-gated live log streaming and log-path visibility on success and failure ([1e2fca1](https://github.com/martinwichner/clispark/commit/1e2fca176a213d8bced4ba90e072e52a847d70b7))
* redact registryUrl and restrict log file permissions to 0o600 ([f6ed00f](https://github.com/martinwichner/clispark/commit/f6ed00fddcc3abbc21387f439fd41575bb823bb7))
* sweep log files older than LOG_RETENTION_DAYS (default 14) on every invocation ([1ed8155](https://github.com/martinwichner/clispark/commit/1ed81556e60f10e63f82c0003fcdec809e5072b0))


### Bug Fixes

* harden logger write calls against I/O failures on both sides ([242b82b](https://github.com/martinwichner/clispark/commit/242b82bf3b536d4171f0f23d8077ef863dde1964))

## [1.4.0](https://github.com/martinwichner/clispark/compare/v1.3.0...v1.4.0) (2026-07-13)


### Features

* add task complete subcommand (required integer arg) ([6cb9baa](https://github.com/martinwichner/clispark/commit/6cb9baac451aa9224093fc13e1ba73647398bedb))
* add task example command (required + enum-constrained args) ([67c4574](https://github.com/martinwichner/clispark/commit/67c457470372e73be08c56a013052fe683dc070a))
* add task list subcommand (two optional args, string + boolean) ([60d92f4](https://github.com/martinwichner/clispark/commit/60d92f427ed89fe09035e14fa3ae6f7093e58691))

## [1.3.0](https://github.com/martinwichner/clispark/compare/v1.2.0...v1.3.0) (2026-07-12)


### Features

* align generated-project build target and docs with the Node &gt;=24 floor ([#16](https://github.com/martinwichner/clispark/issues/16)) ([16c8eb9](https://github.com/martinwichner/clispark/commit/16c8eb935d905d97f2a265bdafaca7e567f00018))

## [1.2.0](https://github.com/martinwichner/clispark/compare/v1.1.1...v1.2.0) (2026-07-12)


### Features

* M6 update mechanism (npx clispark update / releasenotes) ([#11](https://github.com/martinwichner/clispark/issues/11)) ([23e745f](https://github.com/martinwichner/clispark/commit/23e745fd78eecb4294cfc4f5c5e4961e0c8d6a60))

## [1.1.1](https://github.com/martinwichner/clispark/compare/v1.1.0...v1.1.1) (2026-07-12)


### Bug Fixes

* only comment on audit issues when findings actually change ([#9](https://github.com/martinwichner/clispark/issues/9)) ([170900c](https://github.com/martinwichner/clispark/commit/170900c4537337810fda238cb565821f14888a82))

## [1.1.0](https://github.com/martinwichner/clispark/compare/v1.0.1...v1.1.0) (2026-07-11)


### Features

* add ESLint for clispark's own source ([b7ce80e](https://github.com/martinwichner/clispark/commit/b7ce80ebba6416a16a032d85776152182c6f32ff))


### Bug Fixes

* exclude nested worktrees from vitest test collection ([b0b744b](https://github.com/martinwichner/clispark/commit/b0b744b47d51a42420e66a43d21f328d98ba6641))
* run gh pr merge with an explicit --repo in release-please.yml ([22e1879](https://github.com/martinwichner/clispark/commit/22e18790a0d44342ecb610bbbf4af1b1583db891))

## [1.0.1](https://github.com/martinwichner/clispark/compare/v1.0.0...v1.0.1) (2026-07-11)


### Bug Fixes

* grant issues:write to publish.yml's reusable ci.yml call ([18755d6](https://github.com/martinwichner/clispark/commit/18755d637c09d8ff30a681953b861102397a87bb))
* switch npm publish to Trusted Publishing (OIDC), drop NPM_TOKEN ([23220f2](https://github.com/martinwichner/clispark/commit/23220f2bfa416de61c311710bf5154ae78a36c7d))
* unblock release-triggered publish and cross-workflow triggering ([232bc8f](https://github.com/martinwichner/clispark/commit/232bc8f38e4d0c3ae91a0659140b5259f8829866))

## 1.0.0 (2026-07-11)


### Features

* add audit-issues script to track npm audit findings as GitHub issues ([cfc24a7](https://github.com/martinwichner/clispark/commit/cfc24a74829a6bca24416cd56638a88fce5b464d))
* add bundled project template for M2 scaffold engine ([1346458](https://github.com/martinwichner/clispark/commit/13464587abd3c9856aa3a122b62c607abb8b581f))
* add ci.yml workflow (test, audit gate, scaffold smoke test) ([cf3a4bd](https://github.com/martinwichner/clispark/commit/cf3a4bdfb522929723757b207a08250ec5e9afed))
* add commander-based CLI entry point running the wizard ([0bbe8b7](https://github.com/martinwichner/clispark/commit/0bbe8b7d2c91697b8a20a1a283dda37f9c758903))
* add example hello command with oclif test tooling ([ea20802](https://github.com/martinwichner/clispark/commit/ea208029d32d9b5c2c03844433f394d499e10692))
* add generated-project logger and BaseCommand templates ([61562fe](https://github.com/martinwichner/clispark/commit/61562feee360130a444d9c8b36f0228204e526ba))
* add generator-own structured logging and error-handling wrapper ([6f927bc](https://github.com/martinwichner/clispark/commit/6f927bccd327e8a94303c681a3c3af7488291d71))
* add interactive wizard flow with name-check retry loop ([e285057](https://github.com/martinwichner/clispark/commit/e28505755c3f446dbe2285eb079a3353a2bb75db))
* add npm registry package-name availability check ([0cc0c3a](https://github.com/martinwichner/clispark/commit/0cc0c3ae1e84f09c288d8ec19b49f2a18460bfa8))
* add publish.yml to npm-publish on GitHub release ([d11df2f](https://github.com/martinwichner/clispark/commit/d11df2f14e1ea6964ce1af87ecc7e5fb0b415388))
* add release-please.yml for automatic Conventional-Commits version bumping ([f9d411e](https://github.com/martinwichner/clispark/commit/f9d411e858d1ddc040bbfc57eaeff819da2d8ea3))
* add scaffold orchestration (git init/commit, npm install/build) ([7b03eac](https://github.com/martinwichner/clispark/commit/7b03eaceca0a4ed96925de616c7d23c39d984880))
* add template copy and placeholder replacement ([41b6a2d](https://github.com/martinwichner/clispark/commit/41b6a2dabd7535032d34dc16698c3abb5e4c03bf))
* generate ARCHITECTURE.md explaining scaffolded-project conventions ([6f6b231](https://github.com/martinwichner/clispark/commit/6f6b231b8b6c4d126da83f66a9b50c9c2fffacd8))
* pass wizard registryUrl through to scaffoldProject ([4cc8374](https://github.com/martinwichner/clispark/commit/4cc837416c46765e173972d468d59849bffcd1d3))
* wire scaffold engine into CLI action ([99feb35](https://github.com/martinwichner/clispark/commit/99feb35c1c0d837f2cf556b41f9283420ab8bd5a))
* wrap CLI action with generator-own structured logging ([880af80](https://github.com/martinwichner/clispark/commit/880af8008e8a649b1ac23de63638a44955b899f0))
* write .npmrc for a non-default registry during scaffold ([9a7acf8](https://github.com/martinwichner/clispark/commit/9a7acf8608897a7de5c02f248688926bfde3b378))


### Bug Fixes

* build before publish and align publish.yml on Node 22 ([4c197d2](https://github.com/martinwichner/clispark/commit/4c197d233e83fdc9566676a2129d2670e9a1dc0d))
* correct ci.yml Node version and CI-environment gaps found in real Actions run ([f1f5e62](https://github.com/martinwichner/clispark/commit/f1f5e62ba9360abb221375f98a500854457f4584))
* exclude test files from generated build entries and clispark's own test run ([8972309](https://github.com/martinwichner/clispark/commit/897230955dff3e657b3cc804919a220f36b41721))
* handle logger setup failures with the same clean-error guarantee as action failures ([4aa5b96](https://github.com/martinwichner/clispark/commit/4aa5b960e8160ba3cbbf21972350ed9cb670358e))
* handle rejected wizard promise in CLI; tighten project-name validation ([4106ee9](https://github.com/martinwichner/clispark/commit/4106ee97872219d83ef7a855f0f5030ec541345e))
* set explicit rootDir in tsconfig.json files ([ff75b11](https://github.com/martinwichner/clispark/commit/ff75b11bdda8fc38186116b5b323ed4e7c5ace75))
* use cross-spawn to avoid Windows shell-quoting bug in scaffold commands ([86e7fdd](https://github.com/martinwichner/clispark/commit/86e7fdd5b4585af4fe12460c87183dc70bb74744))
* use synchronous pino destination to prevent log loss on process.exit ([b8f1e87](https://github.com/martinwichner/clispark/commit/b8f1e87ba0e201ffea48a63a97cd82b30f39a2ce))
* use vitest 2.x single-type-arg vi.fn syntax in wizard tests ([0ddaf2e](https://github.com/martinwichner/clispark/commit/0ddaf2eb6c5112c82ef55637850243983f879a05))
