# Changelog

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
