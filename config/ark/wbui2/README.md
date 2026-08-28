# Nexus Sentinel — WBUI2 Configuration

This directory is the Nexus-owned source location for externally hosted WBUI2 JSON used by Khaos Nexus ARK: Survival Ascended servers.

## Current Gen 1 configuration

- Repository file: `config/ark/wbui2/gen1.json`
- Raw JSON URL:
  `https://raw.githubusercontent.com/Khaos-Krew/Khaos-Nexus/rebuild/nexus-0.1/config/ark/wbui2/gen1.json`
- WBUI2 compatibility target:
  `https://raw.githubusercontent.com/DC-Modding/WBUI2-Wiki/main/default.json`

The server-side WBUI2 INI should point `JsonURL` at the raw JSON URL, for example:

```ini
[WBUI2]
JsonURL="https://raw.githubusercontent.com/Khaos-Krew/Khaos-Nexus/rebuild/nexus-0.1/config/ark/wbui2/gen1.json"
```

After changing/publishing WBUI2 JSON, force an immediate in-game refresh over RCON with:

```text
cheat scriptcommand WBUI2 update
```

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
