# v0.18.5 validation

Validate that startup release no longer depends on Application Monitor's `monitor-ready` event. The real desktop renderer must verify `app:get-state` and `logs:get`, report base UI readiness, wait 15 seconds for optional modules, satisfy the preserved v0.18.4 `rendererModulesReady` gate, remain on the splash for at least 30 seconds, retain v0.17 profile recovery, exclude the splash from stability monitoring, and package Windows installer and portable builds.
