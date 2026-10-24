# Khaos Nexus ARK Rank Permissions — Implementation Handoff

Status: planning baseline for implementation
Target branch: `rebuild/nexus-0.1`
Primary runtime: Nexus Sentinal + ASA Permissions + ArkShop

## Objective

Implement one authoritative rank-to-ARK permission bridge:

`Discord Server Shop rank role -> Nexus Sentinal -> linked ARK EOS ID -> ASA Permissions group`

Discord remains the purchase/ownership authority for paid Nexus ranks. ASA Permissions is the in-game authorization layer. Sentinel reconciles them and records/audits every change.

Do **not** create a second rank authority in ARK. Do **not** let ARK group state overwrite Discord ownership.

## Canonical Nexus ranks

Existing canonical rank order from `src/shared/ranks.cjs`:

1. `Shadow Recruit` — free/default baseline
2. `Cipher Runner`
3. `Nexus Raider`
4. `Khaos Warden`
5. `Blackout Legend`
6. `Origin Founder` — legacy only, never sold

Discord Server Shop roles are currently authoritative for paid ranks unless Premium App SKU mappings are explicitly configured later.

## ASA Permissions groups

Create these exact groups:

- `Nexus_ShadowRecruit`
- `Nexus_CipherRunner`
- `Nexus_NexusRaider`
- `Nexus_KhaosWarden`
- `Nexus_BlackoutLegend`
- `Nexus_OriginFounder`

Keep supporter groups separate from staff/admin groups.

Do not grant wildcard `*`, cheat permissions, RCON privileges, or administrative permissions to any supporter group.

### Membership invariant

For each linked EOS ID:

- exactly one Nexus supporter rank group should represent the member's current highest Discord rank;
- remove stale lower/higher supporter groups during reconciliation;
- `Origin Founder` is handled as a legacy Discord role, not a purchasable entitlement;
- if no paid/legacy rank exists, assign `Nexus_ShadowRecruit`;
- an unlinked Discord member receives no EOS mutation until account linking exists.

Staff permissions must be additive and independent. Removing a supporter rank must never remove staff groups.

## Required account-link record

Sentinel needs a durable identity binding before automatic permission writes.

Minimum record:

```json
{
  "discordUserId": "...",
  "eosId": "...",
  "verified": true,
  "verifiedAt": "ISO-8601",
  "verificationMethod": "ark-rcon-or-in-game-code",
  "lastRankId": "cipher-runner",
  "lastPermissionGroup": "Nexus_CipherRunner",
  "lastReconciledAt": "ISO-8601"
}
```

Rules:

- one Discord user -> one active EOS identity by default;
- one EOS identity -> one Discord user;
- conflicting claims fail closed and require staff resolution;
- never accept an EOS ID merely because a user typed it into Discord;
- use an in-game verification challenge, live-player correlation, or other proof-of-control before marking `verified=true`.

## Sentinel reconciliation engine

Add a dedicated service, suggested file:

`src/sentinel/ark-rank-permissions-sync.cjs`

Inputs:

- Discord guild member roles
- canonical `NEXUS_RANKS`
- configured Discord rank-role IDs
- verified Discord <-> EOS binding
- current ASA Permissions groups returned by RCON

Desired-state algorithm:

1. Resolve the member's highest canonical Nexus rank.
2. Resolve the verified EOS ID.
3. Query current groups:
   - `Permissions.PlayerGroups <EOSID>`
4. Determine desired Nexus supporter group.
5. Remove stale groups from the known `Nexus_*` supporter allowlist only.
6. Add the desired group if missing:
   - `Permissions.Add <EOSID> <Group>`
7. Query again and verify exact desired state.
8. Persist audit result.

Never issue broad group removals. Only mutate groups in the explicit Nexus supporter-group allowlist.

## Trigger model

Reconcile on:

- Sentinel startup after Discord and ARK RCON are ready;
- Discord member role update affecting a Nexus rank;
- successful account-link verification;
- manual staff `/ark-rank sync` command;
- periodic drift check (recommended every 30 minutes initially).

Use coalescing/debounce so repeated role events do not generate duplicate RCON traffic.

## Failure behavior

Fail closed.

- Discord role lookup failure -> no ARK mutation.
- account not verified -> no ARK mutation.
- RCON unavailable -> queue/retry reconciliation; do not alter Discord roles.
- `Permissions.Add/Remove` ambiguous response -> re-query `Permissions.PlayerGroups`; decide from verified state, not response text alone.
- partial transition -> retry only the missing desired-state operations after a fresh group query.
- unknown external permission groups -> preserve them.

Every mutation should be auditable with Discord user, EOS ID hash/redacted ID, old group, new group, reason, timestamp, map/server, and verification result.

## Cluster behavior

Preferred end state: configure ASA Permissions to use a shared supported database so rank membership follows the player across cluster maps.

Until shared Permissions storage is verified, Sentinel should reconcile the same desired group on every registered ARK server/map independently.

Do not assume tribe IDs are globally safe identifiers for rank ownership. Rank ownership is player/EOS based.

## Initial rank benefit matrix (v1)

This is intentionally useful without turning paid ranks into admin access or heavy pay-to-win.

### Shadow Recruit

- baseline ARK access
- standard shop/catalog access
- standard Sell access
- standard Dino Cache access
- passive NP: current default `2 NP / 5 min` = `24 NP/hour`

ASA group: `Nexus_ShadowRecruit`

### Cipher Runner

- all Shadow Recruit features
- supporter-only shop/kit eligibility where configured
- passive NP target: `3 NP / 5 min` = `36 NP/hour`
- rank-tag eligibility for future AAT cross-chat

ASA group: `Nexus_CipherRunner`

### Nexus Raider

- all Cipher Runner features
- expanded supporter shop/kit eligibility
- passive NP target: `4 NP / 5 min` = `48 NP/hour`
- future increased Nexus Bank limits / dynamic-market daily allowance

ASA group: `Nexus_NexusRaider`

### Khaos Warden

- all Nexus Raider features
- higher-tier supporter shop/kit eligibility
- passive NP target: `5 NP / 5 min` = `60 NP/hour`
- future modest Dino Cache cooldown/limit benefit, implemented by Sentinel rather than bypassing delivery safety

ASA group: `Nexus_KhaosWarden`

### Blackout Legend

- all Khaos Warden features
- highest purchasable supporter shop/kit eligibility
- passive NP target: `6 NP / 5 min` = `72 NP/hour`
- future highest supporter banking / dynamic Sell limits

ASA group: `Nexus_BlackoutLegend`

### Origin Founder

- legacy recognition, never sold
- at least Blackout Legend gameplay/QoL entitlement parity unless owner later defines a founder-only cosmetic perk
- passive NP target: `6 NP / 5 min` = `72 NP/hour`

ASA group: `Nexus_OriginFounder`

## ArkShop integration

ArkShop already integrates with the Permissions plugin by checking group membership.

### Timed Points

Replace the generic two-group reward table with rank-aware groups while keeping `StackRewards=false`:

```json
"TimedPointsReward": {
  "Enabled": true,
  "Interval": 5,
  "StackRewards": false,
  "Groups": {
    "Nexus_ShadowRecruit": { "Amount": 2 },
    "Nexus_CipherRunner": { "Amount": 3 },
    "Nexus_NexusRaider": { "Amount": 4 },
    "Nexus_KhaosWarden": { "Amount": 5 },
    "Nexus_BlackoutLegend": { "Amount": 6 },
    "Nexus_OriginFounder": { "Amount": 6 }
  }
}
```

Because rewards do not stack, a player should receive only the highest applicable amount even during short reconciliation overlap. Still enforce the single-supporter-group invariant.

### Rank-gated kits/items

Use ArkShop's existing `Permissions` field for rank-specific kits or items.

Do not duplicate the entire catalog per rank. Prefer a small set of explicit supporter perks/cosmetics/utility kits.

Example access policy:

- Cipher perk: `Nexus_CipherRunner,Nexus_NexusRaider,Nexus_KhaosWarden,Nexus_BlackoutLegend,Nexus_OriginFounder`
- Raider perk: `Nexus_NexusRaider,Nexus_KhaosWarden,Nexus_BlackoutLegend,Nexus_OriginFounder`
- Warden perk: `Nexus_KhaosWarden,Nexus_BlackoutLegend,Nexus_OriginFounder`
- Legend perk: `Nexus_BlackoutLegend,Nexus_OriginFounder`

Do not grant admin console commands through supporter shop entries.

## Staff permissions — separate phase

If granular in-game staff command authority is desired, use the separate Admins Permissions ASA plugin with its `Cheat.<ConsoleCommand>` permissions.

Proposed principle:

- Moderation staff: only specific moderation/inspection commands required for duties.
- Administrators: broader controlled set.
- Server owner: full authority through existing owner/admin mechanisms.

Never derive these staff groups from paid Nexus ranks.

## Discord rank information updates

After ARK permission sync is proven live:

1. update the managed `#ranks` panel to display ARK benefits per tier;
2. update Discord Server Shop product descriptions to include the same benefit summary;
3. keep pricing authoritative in Discord Server Shop, not hard-coded into Sentinel panels;
4. include language that ARK benefits require the user's Discord account to be linked to their ARK EOS identity;
5. never advertise a perk before the implementation gate for that perk is enabled.

## Commands to implement

Staff:

- `/ark-rank status discord_user`
- `/ark-rank sync discord_user`
- `/ark-rank groups eos_id`
- `/ark-rank audit discord_user`

Player:

- `/ark-link begin`
- `/ark-link status`
- `/ark-link unlink` (with confirmation / safety checks)

Avoid accepting arbitrary target EOS IDs on player-facing commands after linking is available.

## Implementation gates

### Gate A — read-only

- verify ASA Permissions is loaded;
- `Permissions.ListGroups` works over RCON;
- query a known player with `Permissions.PlayerGroups`;
- record current group state without writing.

### Gate B — group bootstrap

- create missing `Nexus_*` groups using `Permissions.AddGroup`;
- query `Permissions.ListGroups` and verify;
- no player memberships changed yet.

### Gate C — owner/test account

- link one known test Discord account to its EOS ID;
- apply one rank group;
- query and verify;
- change the Discord test rank and verify old group removed/new group added;
- remove test paid rank and verify fallback to Shadow Recruit.

### Gate D — ArkShop reward integration

- update TimedPointsReward group names/amounts;
- `ArkShop.Reload`;
- verify reward rate for test rank;
- verify Shadow Recruit/default path;
- verify no reward stacking.

### Gate E — automatic reconciliation

- enable role-event and account-link triggers;
- run periodic drift reconciliation;
- review audit logs for at least one full upgrade/downgrade cycle.

Only after Gate E should rank benefits be advertised as live in Discord Server Shop and `#ranks`.

## Tests required

Unit/integration tests should cover:

- highest Discord rank selection;
- Origin Founder legacy handling;
- unlinked account -> zero RCON mutations;
- conflicting identity binding -> fail closed;
- exact supporter-group allowlist cleanup;
- preservation of unrelated/staff groups;
- idempotent reconciliation;
- upgrade, downgrade, expiration/removal;
- RCON failure/recovery;
- ambiguous RCON response followed by authoritative re-query;
- ArkShop reward table generated for all six ranks;
- no wildcard/admin permissions in supporter policy;
- Discord panel never claims unimplemented perks.

## Handoff acceptance criteria

Implementation is complete when:

- verified Discord-to-EOS linking exists;
- all six Nexus groups exist in ASA Permissions;
- Sentinel can reconcile one player idempotently;
- paid rank upgrade/downgrade updates ARK membership automatically;
- unrelated groups are preserved;
- ArkShop timed NP uses rank groups and verified rates;
- audit history exists;
- rank panel/shop description generator reads the same benefit policy source;
- all changes are covered by tests and deployed behind a reversible feature gate.
