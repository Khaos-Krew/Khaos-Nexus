# Nexus Sentinel — WBUI2 Configuration

This directory is the Nexus-owned source location for externally hosted WBUI2 JSON used by Khaos Nexus ARK: Survival Ascended servers.

## Cluster-wide configuration

All normal Khaos Nexus ARK maps should point to the same shared WBUI2 JSON:

- Repository file: `config/ark/wbui2/cluster.json`
- Raw JSON URL:
  `https://raw.githubusercontent.com/Khaos-Krew/Khaos-Nexus/rebuild/nexus-0.1/config/ark/wbui2/cluster.json`
- WBUI2 compatibility target:
  `https://raw.githubusercontent.com/DC-Modding/WBUI2-Wiki/main/default.json`

Use this on every map:

```ini
[WBUI2]
JsonURL="https://raw.githubusercontent.com/Khaos-Krew/Khaos-Nexus/rebuild/nexus-0.1/config/ark/wbui2/cluster.json"
```

That lets one Nexus UI update propagate to the entire ARK cluster without copying or editing JSON separately for each map.

After changing/publishing WBUI2 JSON, force an immediate in-game refresh over RCON on each applicable online map with:

```text
cheat scriptcommand WBUI2 update
```

## Per-map overrides

Per-map JSON files are optional and should only exist when a map genuinely needs different content. Naming convention:

- `gen1.json`
- `gen2.json`
- `ragnarok.json`
- `theisland.json`
- etc.

`gen1.json` currently mirrors the shared cluster UI so the existing Gen 1 URL continues to work. Once Gen 1 points directly at `cluster.json`, `gen1.json` should only be used if Genesis-specific content is required.

Sentinel should resolve WBUI2 configuration in this order:

1. cluster-wide source of truth;
2. optional per-map override;
3. validate merged WBUI2 document;
4. publish raw JSON;
5. issue `cheat scriptcommand WBUI2 update` to online maps after successful publication.

## Ownership model

Nexus Sentinel should become the authoritative control plane for WBUI2 content. The long-term implementation should store WBUI2 settings, tabs/content, links, images, layouts, and version metadata in Sentinel-managed backend records and render validated JSON artifacts into this directory or a dedicated publication target.

Planned behavior:

- cluster-wide WBUI2 defaults;
- optional per-map overrides;
- JSON validation before publication;
- protected/versioned configuration history;
- publish only valid raw JSON;
- automatic `cheat scriptcommand WBUI2 update` after a successful publication on applicable online maps;
- no manual editing required for normal production changes once Sentinel management is complete.

## File rules

WBUI2 consumes raw JSON, not Markdown. URLs must therefore be plain strings such as `https://i.imgur.com/example.png`, not Markdown links such as `[https://...](https://...)`.

ARKML/WBUI2 markup such as `<TextStyle.Red>...</>` and `<RichColor Color="1,0,0,1">...</>` belongs inside JSON strings. JSON-special double quotes must be escaped with a backslash in the serialized JSON.

Do not place passwords, RCON credentials, API keys, database credentials, Discord tokens, or other secrets in WBUI2 JSON. This content is intended to be publicly readable by game clients.
