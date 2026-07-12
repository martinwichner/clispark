# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).

## Requirements

Node.js **>=24** — this project's entry point (`bin/run.ts`) runs directly via Node's native TypeScript execution, with no build step. On an older Node version it fails with an `ERR_UNKNOWN_FILE_EXTENSION` error rather than a clear version message, so if you hit that, check `node --version` first.
