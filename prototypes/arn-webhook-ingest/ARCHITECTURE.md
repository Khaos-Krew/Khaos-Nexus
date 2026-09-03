# ARN Ingest Architecture

Shiny! Dinos -> private Discord webhook channel -> Sentinel listener -> parser -> classifier -> ARN embed renderer -> public cluster channel.

The private channel is the durable hand-off point for the prototype. Sentinel only accepts webhook-authored messages from the configured ingest channel, and can optionally restrict accepted source webhook IDs to Genesis 1 and Astraeos.

The prototype intentionally does not scan ARK entities, alter Shiny, or require ArkAPI. It consumes the notifications Shiny already emits.

## Event normalization

Incoming titles/descriptions are normalized into four lifecycle events:

- detected
- lost
- contained
- terminated

## Initial classification

- Class I: default anomaly
- Class II: uncommon visual/prefix variants
- Class III: rare prefixes such as Princess, Noir, Pygmy
- Class IV: Enraged / high threat

Enraged detections advertise the configured Khaos Nexus reward of one Tekgram on termination.

## Prototype limitations

This version uses the Discord source message ID for live-process deduplication and does not persist anomaly entity identity across Sentinel restarts. Shiny does not currently provide this prototype with a guaranteed unique ARK creature identifier, so lifecycle correlation is intentionally conservative.
