# Nexus Sentinel Build Feed

Nexus Sentinel owns an additive Discord build feed for manual testing and release announcements.

## Discord destination

On startup, when the Discord bot token and guild ID are configured, Sentinel finds or creates:

- Category: `KHAOS NEXUS`
- Text channel: `#nexus-builds`

Creation is additive only. Existing categories and channels are not deleted, renamed, moved, or replaced. GitHub polling begins automatically when the protected GitHub token is available; a missing token or temporary network failure never blocks normal desktop startup.

## Manual testing notices

Every five minutes Sentinel checks recent GitHub Actions runs in `Khaos-Krew/Khaos-Nexus` using the GitHub token already stored by Khaos Nexus. A testing notice is eligible when:

- the workflow is a Windows/Android owner-test, beta, or release-candidate build;
- the branch or workflow explicitly identifies an owner-test/beta/candidate line;
- the relevant build runs are complete and successful; and
- at least one non-expired product artifact exists.

The Discord embed includes:

- build version when it can be derived from the branch/artifact name;
- branch and commit identity;
- successful build workflows;
- a platform-specific test checklist;
- direct trusted GitHub Actions artifact links; and
- the successful CI run used as evidence.

Windows + Android packages include an end-to-end Mobile Gateway pairing check. The checklist asks the owner tester to reply with `✅ PASS` or `❌ FAIL` and include the failed step plus screenshot/log evidence when available.

Sentinel persists package keys locally in `sentinel-build-feed.json`, so restarting the desktop app does not repost the same artifact set.

## Beta and release notices

Sentinel also checks published GitHub Releases. Existing releases are seeded silently the first time the feed starts so the Discord channel is not flooded with historical posts.

After that initial seed:

- a newly published prerelease/beta posts a **New Beta** embed;
- a newly published stable version posts a **New Release** embed;
- release assets are linked directly when available; and
- the GitHub release page is linked for notes and verification.

Draft releases are never announced.

## Security boundaries

- Discord and GitHub tokens remain in protected local storage and are never included in messages.
- CI does not receive the Discord bot token for this feature.
- Generated Discord messages disable mentions.
- GitHub requests are fixed to the Khaos Nexus repository.
- Artifact links point only to the exact GitHub Actions run/artifact IDs returned by GitHub.
- Channel provisioning is additive and requires the existing Discord `Manage Channels` permission.
- Polling failures are non-fatal to the desktop app and are retried on the next interval.
