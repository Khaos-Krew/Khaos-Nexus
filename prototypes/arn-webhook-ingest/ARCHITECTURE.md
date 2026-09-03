# ARN Ingest Architecture

Each ARK map owns one Shiny Discord webhook. All map webhooks post into the same private Discord channel, Sentinel consumes those webhook-authored messages, and the ARN renderer emits a single normalized result to the shared public cluster channel.

```text
Genesis 1 Shiny -> Genesis 1 webhook --\
                                     +-> private #arn-ingest -> Sentinel -> one ARN output
Astraeos Shiny -> Astraeos webhook --/
```

Future maps follow the same pattern and are added through the webhook-to-map configuration rather than new parser code.

## Source identity

The Discord webhook ID is authoritative for map identity. Shiny title/footer/map text is still parsed as diagnostic metadata. If payload map text disagrees with the registered webhook map, Sentinel logs a cross-wiring warning and keeps the webhook mapping as the source of truth.

Only registered webhook IDs are accepted. Normal user messages and unknown webhooks are ignored.

## Event normalization

Incoming titles/descriptions are normalized into four lifecycle events:

- detected
- lost
- contained
- terminated

One accepted source message can produce at most one ARN output message.

## Initial classification

- Class I: default anomaly
- Class II: uncommon visual/prefix variants
- Class III: rare prefixes such as Princess, Noir, Pygmy
- Class IV: Enraged / high threat

Enraged detections advertise the configured Khaos Nexus reward of one Tekgram on termination.

## Prototype limitations

This version uses the Discord source message ID for live-process deduplication and does not persist anomaly entity identity across Sentinel restarts. Shiny does not currently provide this prototype with a guaranteed unique ARK creature identifier, so lifecycle correlation is intentionally conservative.
