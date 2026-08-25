# Nexus Sentinel Hub Artwork

## Storage model

Google Drive is the canonical creative repository for Nexus artwork. Sentinel does not use authenticated Google Drive links as Discord embed image URLs.

Canonical Drive folders:

- Artwork Repository: `1ovYmLRpgL634O26OXnHy5eCgRYebngRp`
- Banners: `13aQutS3eibes67ziUcydsVCpHix756n4`
- Hub Banners: `1qrEs2D94KzTPO3AvjOSSUvzsY2N8RRuA`
- Game Banners: `14q3WPKYF8W6Ay5rhMTjJ1lPs6GHMXARn`

The runtime mirror is `assets/discord/hub-banners/`. Master/source artwork may remain in Drive at full quality; the optimized Discord copy should be mirrored into this packaged path using the filename declared in `hub-banners.manifest.json`.

## Manifest contract

`assets/discord/hub-banners/hub-banners.manifest.json` is the single source of truth for hub-to-banner assignment. Each banner record can hold:

- Drive folder/file IDs for source provenance.
- A packaged `localPath` used as a Discord attachment when present.
- An optional public HTTPS `runtimeUrl`.
- An optional public HTTPS `fallbackUrl`.
- Version and alt-text metadata.

Resolution order is:

1. Packaged local mirror (`attachment://...`).
2. Public runtime URL.
3. Public fallback URL.
4. No image, while keeping the hub embed operational.

Drive IDs and Drive URLs are metadata only; they are never treated as Discord runtime image URLs.

## Hub Manager behavior

`DiscordHubService` publishes persistent hub embeds. On publish, refresh, rebuild, or refresh-all it reloads the manifest and resolves the current banner assignment again. If the configured Discord message was deleted, publish/rebuild creates a replacement and returns the new message ID.

`discord-hub-extension.cjs` persists hub definitions and exposes protected IPC operations:

- `discord-hubs:get`
- `discord-hubs:resources`
- `discord-hubs:save`
- `discord-hubs:publish`
- `discord-hubs:refresh`
- `discord-hubs:refresh-all`
- `discord-hubs:unpublish`
- `discord-hubs:remove`

Publishing operations require Sentinel operator access and reuse the existing Discord access-control system.

## Artwork workflow

1. Keep the full-quality master in the appropriate linked Drive folder.
2. Export an optimized Discord PNG/WebP with the manifest filename.
3. Mirror that runtime copy into `assets/discord/hub-banners/` for the Sentinel release, or set a public HTTPS runtime/fallback URL.
4. Add the Drive file ID to the manifest for traceability.
5. Refresh the hub. Sentinel re-resolves the banner without changing hub code.

This keeps creative storage centralized in Drive while Discord delivery remains reliable and independent of Drive authentication.
