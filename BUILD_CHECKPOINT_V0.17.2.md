# Khaos Nexus v0.17.2 checkpoint

- Fixes the v0.17.1 startup loop where `renderer-errors:get` required Viewer access before Discord authorization.
- Redacted local UI diagnostic reads and copy-latest remain available before sign-in.
- Clearing retained UI error history remains Owner-only.
- Removes the obsolete v0.17.1 bootstrap authorization error while preserving real button failures.
- Adds regression tests for pre-login diagnostics and migration cleanup.
