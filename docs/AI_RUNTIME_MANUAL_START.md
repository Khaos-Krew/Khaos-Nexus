# AI Runtime Manual Start Policy

The Khaos Nexus AI Runtime remains stopped when the Windows desktop application starts.

## Startup behavior

- Desktop startup registers AI lifecycle IPC and renders the stopped runtime state.
- The shared runtime host, Veyra, and Nexus Sentinel are not spawned during application startup.
- The Owner starts the runtime explicitly with **Start Khaos Nexus AI Runtime** inside the application.
- Bundle verification and service readiness begin only after that explicit action.
- Individual agent Start, Restart, and Stop controls remain Owner-authorized actions.
- Closing Khaos Nexus stops any runtime that the Owner started manually.

This policy prevents AI initialization from delaying normal desktop startup and preserves direct Owner control over local AI resource usage.

## Release acceptance

The updater candidate must prove that a clean-installed desktop reaches its normal interface with no AI host or agent process. The release test must then invoke the same authorized lifecycle contract used by the in-app Start control and verify Veyra and Nexus Sentinel readiness before publication.

After the exact application head passes repository and Windows gates, the corrected build is published through the protected updater workflow for Owner-device testing. Issue #214 remains open until the in-app update is installed and confirmed on the Owner device.
