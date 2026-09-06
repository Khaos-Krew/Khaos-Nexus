# Dino-cache saddle inclusion

New Discord point purchases and Nexus-token redemptions commit a matching saddle decision and a secret-seeded quality roll with the creature. Quality weights are Ramshackle 35%, Apprentice 40%, Journeyman 20%, Mastercraft 5%. No Ascendant outcome. No-saddle creatures explicitly store null; legacy orders remain unchanged. Armadoggo armor is not treated as a riding saddle.

The reveal displays saved saddle quality/status. Dino delivery retains its existing state; saddle delivery is a separate pending/sending/delivered/unconfirmed step and only follows a confirmed dino delivery. Ambiguous item sends are never automatically retried, and neither item failure nor recovery rerolls/reissues the creature.

## Native delivery prerequisite

The official Dino Depot command builder linked from https://www.curseforge.com/ark-survival-ascended/mods/dino-depot has no saddle flag (`-s` means stat block). Do not append an invented saddle argument or use EOS IDs as numeric ARK player IDs.

`NEXUS_CACHE_SADDLE_ENDPOINT` and `NEXUS_CACHE_SADDLE_SECRET` configure a trusted HTTPS native item adapter. It receives `{idempotencyKey, playerId, serverId, reward:{species,quality,quantity:1}}`. It must resolve canonical species to the correct installed saddle, apply server-approved armor/stat caps, target the verified EOS player, persist idempotency before granting, and reply `{idempotencyKey,state:"DELIVERED"}` only after actual delivery. All other outcomes are unconfirmed. Credentials and server changes are not part of this PR.

That adapter does not currently exist in the inspected runtime. This PR is not ready for live saddle fulfillment until it is implemented and tested on the server. Missing configuration leaves saddles pending. Existing uncertain dino deliveries also require verification before their saddle step. No completed or legacy orders are backfilled.

## ARN identity integration

The companion ARN runtime can use `/arn/identity?discordUserId=...` on Sentinal's existing admin listener with the dedicated `ARN_SENTINAL_JOB_SECRET` Bearer credential. It returns only one verified EOS link; absent, unverified or multiple links fail closed. This credential does not authorize the generic admin routes. The route is unavailable without its own 32-character secret. Set `ARN_IDENTITY_ENDPOINT` on ARN only after deployment and verification; no variables were changed in this PR.
