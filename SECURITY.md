# Security Policy

## Supported Versions

Only the latest published version of `clispark` on npm is supported. Please update to the latest version before reporting an issue.

## Reporting a Vulnerability

If you believe you've found a security vulnerability in `clispark`, please report it privately via [GitHub's private vulnerability reporting](https://github.com/martinwichner/clispark/security/advisories/new) rather than opening a public issue.

Non-security bugs should go through the normal [issue tracker](https://github.com/martinwichner/clispark/issues) instead.

## Automated Dependency Scanning

This repository runs `npm audit` on every CI build (high/critical findings block the build; moderate/low findings are tracked as issues), and has Dependabot alerts enabled for continuous scanning between builds.
