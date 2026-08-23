# Rank SKU discovery correction — 2026-08-23

Discord Premium App rank discovery must treat recurring subscription SKUs and durable one-time purchase SKUs as independent entitlement sources for the same Nexus rank.

Nexus maps Discord SKU types as follows for rank access:

- type 2 — durable one-time purchase: eligible rank entitlement source
- type 5 — recurring subscription: eligible rank entitlement source
- type 6 — generated subscription group: ignored
- type 3 — consumable one-time purchase: ignored for persistent Nexus ranks

A rank may therefore contain multiple SKU IDs (for example, Blackout Legend monthly plus Blackout Legend lifetime). Discovery may match the canonical rank name exactly or with an allowlisted monetization suffix such as `monthly`, `subscription`, `lifetime`, `one-time-purchase`, or `access`. Existing configured mappings are never overwritten automatically.
