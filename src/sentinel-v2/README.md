# Sentinel v2 runtime

This namespace is the isolated rebuild described in GitHub issue #568.

Initial foundation includes:
- validated configuration with canonical `NEXUS_SENTINEL_*` names and temporary legacy aliases;
- structured JSON logging;
- centralized job scheduler primitive with concurrency and timeout protection;
- liveness/readiness state;
- incident deduplication;
- mutation safety gate defaulting to disabled/dry-run.

Production cutover is intentionally separate from this implementation branch.
