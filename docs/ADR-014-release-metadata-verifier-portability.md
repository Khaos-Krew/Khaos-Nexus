# ADR-014 — Release metadata verifier portability

## Status
Accepted for the v0.40.1 production release hotfix.

## Decision
Release metadata verification must use JavaScript-compatible regular-expression flags and must be covered against both LF and CRLF updater metadata. PCRE-style inline flags such as `(?m)` are forbidden in JavaScript release tooling.

The reusable `latest.yml` version matcher lives in `scripts/release-metadata.cjs`; `scripts/verify-release-artifacts.cjs` consumes that matcher instead of constructing its own inline regular expression.

## Reason
The first protected v0.40.1 publisher successfully completed source validation, Windows packaging, packaged startup, clean installation, and the v0.40.0 -> v0.40.1 upgrade, then failed only when the release artifact verifier attempted to construct `/(?m).../` in Node.js. JavaScript does not support PCRE-style inline `(?m)` flags. The `m` flag must be supplied as the second argument to `RegExp`.

## Release boundary
This hotfix changes release verification only. It does not change desktop runtime behavior, AI authority, D&D authority, updater behavior, package contents, or the v0.40.1 application feature set.
