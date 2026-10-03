# ARK NP Shop Rebuild: Starter Kit, Bank, Caches on Nexus Points (PLAN)

| | |
|---|---|
| Owner decision | 2026-10-02 7:29 PM CT: rebuild starter kit, bank and caches on NP. ArkShop + its MySQL wallet stay retired (option A in `handoffs/ARKSHOP_GUARD_GEN1_MAP2_DIAG_2026-10-02.md`). |
| Status | **BUILD-READY 2026-10-02; stacked on #689.** Owner decisions 2026-10-02 8:05 PM CT are folded in (see OWNER DECISIONS). All flags off until each separate owner go. |
| Currency | NP only. ARK is an RCON-delivery/playtime game. **No Coins path.** The system-grant gate (Coins-only) never carries NP. |
| Depends on | PR #689's NP shop core (Minecraft). Not merged as of 2026-10-02 CT. Latest head `fc4ef75` (rebased on base `008ce9c`) has the review fixes and got ARCHITECT SIGN-OFF with flags off. See "PR #689 final sign-off" in `docs/architecture/MC_POINTS_ARCH_REVIEW_2026-10-01.md`. |
| Author | ARCHITECT, 2026-10-02 CT |
| Revision | **2026-10-02 8:14 PM CT (owner):** the legacy-bank read-only diff and the `legacy-bank-port:<econId>` credit are **dropped**. They're replaced by a **flat one-time 1,500 NP credit per economic identity with a verified ARK (EOS) link**, key `legacy-bank-flat:<econId>`. It ships with this rebuild behind the existing ARK shop writes flag, with an owner-reviewed dry-run list first. LEDGER's reason code and guards are merged into §4 (8:15 PM CT). Sections updated: §4, §8, §10, LEDGER Q4/A4, OWNER DECISIONS. |
| Revision | **2026-10-02 ~8:25 PM CT: WARDEN W-LB-1..3 folded** (`docs/security/ARK_LEGACY_NP_BATCH_REVIEW_2026-10-02.md`, verdict: REQUIRED CHANGES, NOT SIGNED OFF).
- `restricted` identities are excluded; eligibility needs verified status plus Discord and EOS links plus not on Q-01.
- One payout per human; shared Discord/EOS rows are held.
- The batch has its own one-shot gate (approved-hash env plus a run-once marker); the shop writes flag is neither required nor sufficient.
- The full-row hash is recomputed from the DB.
- Fixed snapshot cutoff of 2026-10-02 8:14 PM CT, an owner-approved count/total ceiling, and operator/host/commit audit.

Sections: §4, §8, §10, LEDGER annotation, OWNER DECISIONS. **Owner approved the concept only. The list, count, total and run are NOT approved.** |

## 1. Context (verified, read-only)
- **Why the guard fails closed:** ArkShop folders are `ArkShop_DISABLED` on Gen1 + map2 (Citadel). The guard reports `config-read-failed`, and `ARKSHOP_DB_MODE=disabled` (diag handoff).
  - `ark-cache-shop-service.cjs` debits the ArkShop MySQL points table, so it can't work anymore.
- **Points port:** ArkShop points were **added 1:1** on top of NP on 2026-09-21. Key `arkshop-migrate-2026-09-21-add:{discordUserId}:NEXUS_POINTS` (`docs/ops/ARKSHOP_POINTS_PORT_2026-09-21.md:3-6`). Old ArkShop prices are therefore already in NP units.
- **ARK NP rates:**
  - `src/shared/nexus-economy-rank-perks.cjs:7-32`: 2 / 4 / 10 NP per 5 min (= 24 / 48 / 120 NP/h).
  - Passive 0–10 NP/h, capped at 48 h (`:3`).
  - Accrual runs in `src/economy-worker/postgres-accrual.cjs`.
- **Delivery building blocks (owner-locked: Rewards Ascended via Sentinal, `docs/ops/SHOP_ENABLE_CHECKLIST_2026-09-15.md:9,19`):**
  - `src/sentinel/rewards-ascended-delivery.cjs`: the per-order reward is written to the RA config over SFTP and verified (`:117-183`), then `RA.Reload` (`:205`), then `RA.Reward <EOS> <rewardId>` (`:221`).
  - Reply classification (`:194-200`):
    - only `^Player rewarded!$` → DELIVERED;
    - an explicit reject → DELIVERY_FAILED;
    - blank, no reply or anything else → SENT_UNCONFIRMED.
  - Map routing: `findOnlineServer(eosId)` probes `ListPlayers` on every eligible prefix and **throws if the EOS id is online on more than one map** (`src/sentinel/ark-dino-box-delivery-worker.cjs:69-85`). A stale `DELIVERING` claim older than 10 min → SENT_UNCONFIRMED (`:171`).
- **Old "bank"** (`src/sentinel/ark-nexus-bank.cjs`, 313 lines) was a JSON-file store keyed by EOS.
  - deposit/withdraw (max 1,000,000) moved **ArkShop in-game points** to and from the bank.
  - Legacy RCON point ops: `GetPlayerPoints`, `AddPoints`, `SetPoints` (`src/sentinel/arkshop-rcon-points.cjs`).
  - The ArkShop in-game wallet no longer exists, so there's nothing left to deposit from or withdraw to.

## 2. Architecture (shared NP shop core, `provider: 'ark' | 'minecraft'`)
**Shared (generalize #689, no copy):**
- **Atomic buy:** one Postgres client transaction does all of the following:
  - per-identity advisory lock;
  - quote row `FOR UPDATE`;
  - ledger insert with key `np-shop:<provider>:<econId>:<sku>:<nonce>`;
  - wallet `FOR UPDATE` + update;
  - order insert (randomUUID id; price/catalog-version snapshot).
- **Order state machine:** CAS transitions plus a lease token issued by `FOR UPDATE SKIP LOCKED` claim. REFUNDED and DELIVERED are terminal. An expired DELIVERY_IN_PROGRESS → SENT_UNCONFIRMED.
- **Refund transaction:** CAS → REFUNDED + reversal `np-shop-refund:<orderId>` in the same transaction.
- **Limits and audit:** **no** per-purchase, daily NP, daily order or per-SKU caps for ARK (owner 8:05 PM CT). Kept: balance check, eligibility, staff-refund cap and audit rows, quotes stored in the DB.
- **MUST (LEDGER R2-1):** every buy check (quote validity, eligibility/quarantine, catalog/price recheck, balance) runs **after** `pg_advisory_xact_lock(econId)` and inside the same transaction as the debit. #689's Postgres buy ran some checks before the lock (`mc-points-postgres.cjs` `#buy`), and the ARK path must not inherit that. **Test:** two concurrent buys that together exceed the balance → exactly one succeeds and the balance never goes negative.
- **SHOULD (not a cap):** a non-blocking staff alert when one identity spends more than N NP in 24 h (N set by LEDGER). The purchase still goes through.
- **Scoped caller tokens** (`requestScope`/`craftRouteAllowed` pattern in `server.cjs`).
- **Schema change:** rename/extend the #689 tables with a `provider` column, and add the new routes to `FINANCIAL_WRITE_PATHS` and the drain set. Each dispatcher claims **only its own provider** (`WHERE provider=$1`).

**ARK-specific:**
- **Catalog:** `src/shared/ark-np-catalog.cjs`. Items reference RA reward templates and blueprints. Allow-list only, with blueprints validated by the existing `blueprintRef` regex (`rewards-ascended-delivery.cjs:34-38`).
- **Eligibility:** verified identity + verified **EOS** link (same as ARK accrual's `#resolveByEos`).
- **Dispatcher** runs in Sentinal (owner lock), on its own scoped token `NEXUS_ECONOMY_ARK_DELIVERY_TOKEN`, limited to claim / delivery-status / refund-sweep for `provider='ark'`.
- **Legacy code stays off:** don't revive the ArkShop MySQL code path. `ark-cache-shop-service.cjs` stays dead, and the guard gets the `mode=arkshop-retired` message (diag optional PR).

## 3. Delivery (RCON / Rewards Ascended)
1. Claim one `provider='ark'` order and get its lease token.
2. **Target by EOS id**, never by name. The EOS id is cleaned (`cleanEosId`) and taken from the verified link, not from user input.
3. **Online check / routing:** `findOnlineServer` (ListPlayers on each eligible prefix).
   - Not online anywhere → PLAYER_OFFLINE (backoff 1→30 min).
   - Online on more than one map → hold as PLAYER_OFFLINE with a warn log (never guess).
   - Deliver on the map the player is on **now**. The order keeps no map binding.
4. Write the RA reward template on **that map's** config (SFTP + verify) → `RA.Reload` (must reply `^Reloaded config$`, else DELIVERY_FAILED pre-send: safe, retryable) → mark DELIVERY_IN_PROGRESS (CAS + lease) → `RA.Reward <EOS> <rewardId>`.
5. Parse the reply:
   - exactly `Player rewarded!` → DELIVERED;
   - explicit reject → DELIVERY_FAILED;
   - anything else, a timeout or a transport error after send → **SENT_UNCONFIRMED** (never auto-retried).
6. One RA reward per order line. Multi-line orders such as the kit are delivered as **one RA reward with all items**, so there's one confirmation per order and no partial delivery.
7. Caches reuse the existing per-order cryopod reward builder (`buildRewardEntry`, `:41`; RA ≥1.02, `:135`) and `config/ark/shop/cache-policy.json`. Shiny stays off, Dino Depot stays fallback-only, and the cache fail-closed rule is kept.

## 4. "Bank" (recommendation)
- **Recommend: "bank" = the NP balance.** `/points` shows the balance, the last 10 ledger rows and pending orders. There's no deposit or withdraw: NP already lives in the Postgres wallet, and the old bank's other side (ArkShop in-game points) is retired.
- An in-game item/element deposit is **out of scope**. No verified RCON path exists to remove items from a player safely, and it would be a new faucet.
- **Legacy bank: flat one-time credit.** Owner concept 2026-10-02 8:14 PM CT; LEDGER entry shape 8:15 PM CT; WARDEN required changes W-LB-1..3 folded ~8:25 PM CT.
  - Every eligible human gets **1,500 NP once**.
  - There's no per-player bank diff; the old `ark-nexus-bank` JSON isn't read.
  - **Approval status:** the owner approved the **concept only**. The **list, list hash, count, total and execution are NOT approved**, and no `ownerApprovalRef` exists yet. Concept approval must never be treated as list approval.

**Data model**
- **Ledger row per grant:**
  - `type=credit`, `currency=NEXUS_POINTS`, `amount=1500`;
  - reason/source **`legacy_bank_flat`** (not `system_grant`, which is Coins-only);
  - idempotency key **`legacy-bank-flat:<econId>`** (unique);
  - recorded against the contra account `system:mint:legacy-bank-flat`;
  - metadata `{batchId, snapshotAt, ownerApprovalRef, dryRunListHash, denylistHash, eosIds:[…]}`. `denylistHash` is a hash of the Q-01 denylist, never its contents.
- **Run-once marker table (new, W-LB-2):** `nexus_economy_batches`.

  | Column | Notes |
  |---|---|
  | `batch_name` | PK; UNIQUE, e.g. `legacy-bank-flat-2026-10` |
  | `list_hash` | |
  | `approval_ref` | |
  | `approved_count` | |
  | `approved_total` | |
  | `operator` | |
  | `host` | |
  | `commit_sha` | |
  | `started_at` | |
  | `completed_at` | |

- **Audit row per grant:**
  - operator identity (actor), host and commit SHA;
  - batch name, econId, amount, key.

**Eligibility (W-LB-1, one payout per human)**
- Required, all of:
  - `status='verified'`;
  - a **verified Discord link** with `verified_at <= snapshotAt`;
  - a **verified EOS link** with `verified_at <= snapshotAt`;
  - **not** on the Q-01 denylist.
- **`restricted` is excluded.** Under SYBIL_QUARANTINE_CRITERIA §2 it *is* the quarantine status (skip `quarantined`). `disabled` is excluded (skip `disabled`).
- Identities created after the snapshot are ineligible.
- **Fixed snapshot cutoff (W-LB-3):** `snapshotAt = 2026-10-02 20:14 CT` (the owner's decision time), not the dry-run or deploy time. Links verified after that don't qualify.
- **One per human:** any eligible row that shares a Discord id **or** an EOS id with another identity (eligible or not) is **HELD, not paid**, with `skipReason=duplicate_human`. The owner reviews held rows; a held row is never auto-paid.
- An identity with several linked EOS ids is still one row and one credit.
- **Named case:** `econ_legacy_064c274f…` (147 NP, `restricted` = quarantined, verified EOS `0002a40e…`). It carries Discord id `143909213712809984`, the same id as the guild owner, so it's a possible duplicate human.
  - It is **excluded** as `quarantined`.
  - It is also flagged `duplicate_human` against the owner's other identity, which is **held** too, never auto-paid, until the owner decides.
- Status **and** denylist are checked at dry-run **and** again inside the lock at execution.

**Data flow**
1. **Dry-run** (`scripts/legacy-bank-flat.cjs --dry-run`, read-only, named operator). Using the fixed snapshot, it writes the owner list with these columns:

   | Column | Notes |
   |---|---|
   | `econId` | |
   | `discordUserId` | |
   | `eosIds` | all verified EOS ids, sorted |
   | `amount` | 1500, or 0 if skipped/held |
   | `skipReason` | `quarantined` \| `disabled` \| `not_verified` \| `duplicate_human` \| `already_credited` \| empty |

   - `not_verified` covers a missing verified Discord link, or links verified after the snapshot.
   - It also prints the eligible count N, the total N × 1500, and the **list hash**.
2. **The list hash (W-LB-3)** is SHA-256 over canonical JSON:
   - a header `{batchName, snapshotAt, amountPerGrant:1500, eligibleCount, total}`;
   - **every** row sorted by econId, as `[econId, discordUserId, sortedEosIds, amount, skipReason]`.
   - So a swapped identity changes the hash even when the count and total stay the same.
3. **The owner approves the exact hash, N and total.** Only then does the owner set the one-shot env **`NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH=<hash>`**, and records `ownerApprovalRef`, approved N and approved total.
4. **Execute** (`--execute`, one-shot CLI, named operator with DB credentials; no endpoint, no bot token, no Discord command). It **refuses** unless all of these hold:

   | Check |
   |---|
   | the marker row for `batch_name` is absent, or present with `completed_at` null (an incomplete run may be re-run only to fill gaps) |
   | the list, **recomputed from the DB** at the frozen snapshot (never read from the CSV), hashes to exactly `NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH` |
   | **hard ceiling:** N ≤ approved N **and** N × 1500 ≤ approved total |
   | every grant is exactly 1500 |

   The ARK shop writes flag is **neither required nor sufficient** (W-LB-2).
5. **Per grant**, one transaction:
   1. `pg_advisory_xact_lock(econId)`;
   2. recheck status and denylist inside the lock;
   3. ledger insert ON CONFLICT (key) DO NOTHING;
   4. wallet update;
   5. audit row.
6. **Finish:**
   - set `completed_at`;
   - **reconcile:** the sum of member `legacy_bank_flat` credits (including reversals) equals −1500 × grants, and that sum equals the negation of the contra account `system:mint:legacy-bank-flat` balance (contra balance = −1500 × grants). The mint is a non-spendable `system` account, not a verified member, and is excluded from member balance sums and reports. Grants = approved N minus in-lock skips;
   - the operator **unsets** `NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH`.
   - A completed marker makes any later run refuse.

**Failure modes**
- **Crash mid-batch:** the marker stays incomplete. A re-run with the same approved hash fills gaps; existing keys are no-ops.
- **Identity quarantined or disabled between the dry-run and execution:** skipped in the lock and logged. The ceiling still holds, because N only goes down.
- **DB state changed so the recomputed hash differs:** the batch refuses and writes nothing. A new dry-run and a new owner approval are needed.
- **Wrong credit:** reversed only by an audited admin debit with key **`legacy-bank-flat-reversal:<econId>`**, once per identity. If the NP was already spent (debit to a negative balance, partial reversal, or leave it), that's an **owner decision** (open item).

**Security**
- No player-facing surface, and NP never goes through the Coins system-grant gate.
- The mint has its own owner-bound gate (approved hash plus a run-once marker), independent of the shop flag.
- The full-row hash is recomputed from the DB.
- The fixed snapshot stops post-announcement link farming.
- Quarantined (`restricted`) identities are excluded.
- One payout per human (shared Discord/EOS ids are held).
- The Q-01 denylist is enforced in this batch even though the accrual path still has a gap (ARK_QUARANTINE_ACCRUAL_GAP_2026-10-02).
- Issuance is reconcilable through the contra account.

**Migration / rollout**
- Ships in this PR.
- Order: dry-run → owner approves hash/N/total → owner sets the env → execute once → reconcile → unset the env.
- The old `legacy-bank-port` diff tool is not built.
- The 3 unported unknown-EOS rows from the 2026-09-21 port qualify only if they meet the eligibility above by the snapshot.

**Tradeoff**
- Simpler and auditable without the old bank file. Players with large old bank balances get exactly 1,500, the same as players with none (owner concept 8:14 PM CT).
- The stricter eligibility may leave some real players held or ineligible. The owner resolves held rows by hand.

## 5. Cache pricing (old ArkShop price = NP 1:1 after the port; all PENDING LEDGER)
| Cache | Old ArkShop price | Proposed NP | Source |
|---|---|---|---|
| Coastal | 150 | 150 | `config/ark/dino-caches.json:67` |
| Forest | 200 | 200 | `:68` |
| Swamp | 200 | 200 | `:69` |
| Mountain | 250 | 250 | `:70` |
| Ocean | 350 | 350 | `:71` |
| Deep Cave | 350 | 350 | `:72` |
| Apex | 550 | 550 | `:73` |
| Fantastical Tames | 400 | 400 | `config/ark/dino-cache-dlc-additions.json:125-129` |
| Bob's Tall Tales | 400 | 400 | `:137-141` |
| Winged | 300 | 300 | `:149-152` |

- Earn time at 48 NP/h: Coastal ≈ 3.1 h, Apex ≈ 11.5 h. At 120 NP/h, Apex ≈ 4.6 h.
- Per-box cooldown: 5 min (`cooldownMinutes` in the same file). Level range 200–300 (`cache-policy.json`).
- **Owner-decided:** prices stay 1:1, with a review after 30 days of order data. Other cluster-shop items aren't part of this rebuild.
- **Weekly cache: RETIRED** (owner 7:52 PM CT). `src/sentinel/ark-weekly-cache.cjs` (`WEEKLY_PRICE = 900`) isn't ported to the NP catalog, and its Sentinal surface is removed or kept off.

## 6. One-time ARK Starter Kit
- **Contents:** today's `starter` kit, `Price: 0`, "one free spawn-only claim" (`config/ark/wshop/nexus-wshop-migration.json:31-34`, items `:36+`).
  - Metal pick, metal hatchet, crossbow, 50 tranq arrows, spyglass, 10 parachutes, 10 bolas, 25 healing soup, canteen, 50 cooked meat, 3 hide sleeping bags, metal armor pieces, …
  - LEDGER confirms the full list and value.
- **One per economic identity, ever:**
  - grant row `kind='ark_starter_kit'` with UNIQUE (kind, econId) **and** UNIQUE (kind, eosId);
  - order with `price=0, source='ark-starter-kit'`, all in one transaction.
  - Free (0 NP), so there's no ledger row; the grant row is the idempotency record, same as the #689 kit. `metadata.notionalNp = 150` is for reconciliation only and never touches a balance (owner-decided).
- **Eligibility:**
  - verified identity + verified EOS link;
  - not quarantined;
  - Discord account age and server join date are **fetched by Sentinal** from the guild member, never caller-supplied.
- **MC interaction:** **independent**. One ARK kit and one MC kit per identity; separate `kind` values and separate eligibility. Owner can choose "one kit across games" instead (decision 3).
- `OnlyFromSpawn`: RA can't enforce it. Drop the rule (recommended); delivery goes wherever the player is.

## 7. Idempotency and refunds (same as #689)
- **Keys:**
  - buy: ledger key `np-shop:ark:<econId>:<sku>:<nonce>`, nonce UNIQUE;
  - refund: reversal `np-shop-refund:<orderId>`;
  - kit: grant uniques.
- **Auto-refund:**
  - DELIVERY_FAILED with nothing sent → refund now.
  - PAID or PLAYER_OFFLINE for 14 days from `paid_at` → refund, done by a worker sweep that still runs with delivery off.
- **Never refunded:** DELIVERED (no refund at all), and SENT_UNCONFIRMED (not auto-refunded).
- **Staff refunds:** Sentinal-token route only, from SENT_UNCONFIRMED/DELIVERY_FAILED only.
  - Required reason and actor id.
  - Audit row kept 365 days.
  - Cap: 10 per staff member per day (the #689 `STAFF_REFUND_DAILY_CAP`).
  - Verify the player's inventory/RA log before refunding SENT_UNCONFIRMED.

## 8. Flags, WARDEN, GATEKEEPER, dry-run
- **Flags:** all default **false**, enforced in the **worker** and in Sentinal.
  - `ARK_SHOP_ENABLED`: buy and quote.
  - `ARK_SHOP_DELIVERY_ENABLED`: claim and delivery-status.
  - `ARK_STARTER_KIT_ENABLED`.
  - `ARK_SHOP_DRY_RUN` (default **true**): quote and log only, no debit and no RA calls.
- **Money gate:** recommend a narrow `NEXUS_ECONOMY_NP_SHOP_WRITES_ENABLED`, which covers the `/np-shop/*` debit and refund only. It **does not** cover the `legacy_bank_flat` mint: that batch has its own one-shot gate (`NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH` plus the run-once marker, §4), and the shop flag is neither required nor sufficient for it (WARDEN W-LB-2). It's preferable to flipping global `NEXUS_ECONOMY_WRITES_ENABLED`, which also opens `/wallet/credit` and the legacy shop. Owner decision 5.
- **Kill-switch order:** shop off → delivery off → narrow writes off.
- **No dual delivery:** `NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED` and `NEXUS_ECONOMY_PURCHASE_EXECUTION_ENABLED` stay **false**.
- **WARDEN sign-off points:**
  - narrow gate scope;
  - kit outside the money gates (0 NP);
  - EOS-only targeting;
  - staff refund rules;
  - catalog allow-list;
  - Sentinal-fetched kit eligibility;
  - legacy-bank-flat batch: **WARDEN NOT SIGNED OFF** as of ~8:25 PM CT. W-LB-1..3 are folded into §4 and need WARDEN re-review before any execute.
- **GATEKEEPER checks:**
  - tip green, with tests for state machine, refund race and multi-map hold;
  - flags false on both services;
  - RA ≥1.02 and the effective config path is SFTP-visible on Gen1 + map2 (`:146-148`);
  - `RA.Reward` reply text verified on Citadel once;
  - the ArkShop guard shows the retired message.
- **Legacy-bank-flat:** run the dry-run (fixed snapshot 2026-10-02 20:14 CT), then the owner approves hash/N/total and sets the one-shot env, then execute, reconcile and unset. Execution is never tied to the shop flags (§4).
- **Dry-run:** 24–48 h on one map with dry-run on. Then one staff test purchase per cache tier plus one kit, with `RA.Reward` confirmed in-game once. Then a reconcile check: orders ↔ purchase rows ↔ reversals, 1:1 and ≤1.

## 9. Member UX (dead simple)
- **`/shop`:**
  - Category buttons: **Starter Kit · Dino Caches · Bank (balance)**.
  - Item card: name, NP price, balance before → after, "delivered on whatever map you're on".
  - **Confirm**, then a receipt (order id) with a status DM-free ephemeral update: Queued (offline) / Delivered / Needs staff.
- **`/points`:** balance, recent activity, pending orders. This is "the bank".
- **Staff (separate command):** `/arkshop-admin orders|resolve <id> delivered|refund <reason>|kits`, Administrator or the O9 allow-list.
- **HERALD guide entry** (owner rule): "Spending Nexus Points on ARK". It explains earn rates, caches, the kit, offline queueing, refunds, and that ArkShop is gone. LEDGER provides the final numbers.

## 10. Scope and size
- **One cloud-agent PR, stacked on #689** (or rebased right after it merges).
- **Size about 4.75 days** (was 4.5; +0.25 d for WARDEN W-LB-1..3 on the flat batch):
  - core generalization (`provider` column, routes, scopes; lock-first buy + concurrency test): 1 d;
  - ARK catalog + RA dispatcher (lease, routing, parse): 1.5 d;
  - kit + `/shop` / `/points` UX + staff: 1 d;
  - tests + docs + HERALD draft: 0.75 d (the cap logic and tests are gone);
  - legacy-bank-flat: dry-run list, canonical full-row hash, one-shot env gate, run-once marker table, duplicate-human hold, in-lock rechecks, reconcile, tests: **0.5 d** (+0.25 d for WARDEN W-LB-1..3).
- **Out of scope:** item deposit/withdraw, re-enabling the ArkShop plugin, Coins anything, ARN (separate plan).

## 11. ARN cache (separate plan)
- See `plans/ARN_CACHE_PLAN_2026-10-02.md`: ARN tokens drop from shiny tame/kill, and an ARN cache opened with a token grants a tame from a rotating list.
- It reuses this plan's shared core (orders/outbox, RA delivery, refund), with a token as payment instead of NP.
- It replaces the weekly cache, which is retired.

## LEDGER QUESTIONS (all owner-decided 2026-10-02 8:05 PM CT)
1. **DECIDED: 1:1, review after 30 days.** Keep the cache NP prices 1:1 with the old ArkShop prices (150–550; table §5), or retune for the 24/48/120 NP/h rates?
2. **DECIDED: free, once per identity and per EOS id, grant row, notional 150 NP in metadata.** Starter Kit: confirm the contents (`nexus-wshop-migration.json:31+`) and that it's free (0 NP). Its NP-equivalent value, for the reconcile report?
3. **DECIDED: NO caps of any kind (purchase/daily NP/daily orders/per-cache).** Balance and eligibility are checked inside the lock (MUST, §2). Caps: per-purchase cap (MC uses ≤500 NP; Apex is 550 so it needs ≥550), daily NP cap (MC 1,500), daily orders (MC 10), per-cache daily limit?
4. **DECIDED (revised 8:14 PM CT): flat 1,500 NP per econId with a verified ARK link, `legacy-bank-flat:<econId>`, dry-run list → owner OK (§4). The diff/`legacy-bank-port` approach is dropped.** Leftover `ark-nexus-bank` JSON balances: credit once, or treat as already covered by the 2026-09-21 port?
5. **DECIDED: keep both.** Refunds: keep the 14-day auto window and the 10/day staff cap for ARK?

## LEDGER ANSWERS (2026-10-02)
Author: LEDGER. Read-only evidence from the box. **Every price, cap and value below is PROPOSED, owner to confirm**, unless marked as on-box fact.

**1. Cache prices: keep 1:1 with ArkShop (PROPOSED).**
- Fact: the 2026-09-21 port **added ArkShop points 1:1** into NP (`docs/ops/ARKSHOP_POINTS_PORT_2026-09-21.md:3-6`).
- Fact: the Nexus ArkShop timed-points config pays **2 per 5 min (Default / Shadow Recruit) and 4 per 5 min (ranks)** = 24 / 48 NP/h (`config/ark/wshop/nexus-wshop-migration.json:1250-1277`), the same as NP for every rank except Origin Founder (ArkShop 4, NP 10 per 5 min).
- Caveat: `src/sentinel/arkshop-nexus-economy.cjs:23-25` records an older **legacy baseline of 5 (Default) / 15 (Premiums) per 5 min** (60 / 180 per hour). If the cache prices were set under that baseline, caches now take ~2.5× longer to earn for non-premium players. Which rate was live when the prices were set is **UNKNOWN**.
- Recommendation: keep 1:1 at launch (no repricing surprise, ported balances keep their buying power), and review after 30 days of order data. Retune only if median time-to-first-Apex for ranked players is > ~2 weeks.

| Cache | NP | h @ 24/h | h @ 48/h | h @ 120/h |
|---|---|---|---|---|
| Coastal | 150 | 6.3 | 3.1 | 1.3 |
| Forest / Swamp | 200 | 8.3 | 4.2 | 1.7 |
| Mountain | 250 | 10.4 | 5.2 | 2.1 |
| Winged | 300 | 12.5 | 6.3 | 2.5 |
| Ocean / Deep Cave | 350 | 14.6 | 7.3 | 2.9 |
| Fantastical / Bob's | 400 | 16.7 | 8.3 | 3.3 |
| Apex | 550 | 22.9 | 11.5 | 4.6 |
Online hours only. Passive adds 0–10 NP/h by rank while offline, capped at 48 h per stretch (≤ 480 NP for Blackout Legend), so ranked players reach caches sooner than the table shows.

**2. Starter Kit: free, once per identity + once per EOS, grant table (PROPOSED).**
- Contents: the existing `starter` kit as listed (`nexus-wshop-migration.json:31+`: metal pick, hatchet, crossbow, 50 tranq arrows, spyglass, 10 parachutes, 10 bolas, 25 soup, canteen, 50 cooked meat, 3 sleeping bags, metal armor…). ArkShop listed it at `Price: 0` with `DefaultAmount: 1`; the legacy baseline had 2 (`arkshop-nexus-economy.cjs:30`). One claim is proposed.
- Record: a grant row (`kind='ark_starter_kit'`, UNIQUE (kind, econId) and UNIQUE (kind, eosId)) plus a 0-NP order on the shared outbox. **No ledger row and no balance change**, mirroring the #689 MC kit.
- Value for reconciliation: no NP price exists on the box for these items (UNKNOWN). Store `metadata.notionalNp` for reporting only; PROPOSED **150 NP** (≈ one Coastal cache), owner to confirm. It never touches balances. The reconcile report lists kits as count × notional, separate from the NP ledger.

**3. Caps for ARK: SUPERSEDED. The owner decided no caps (2026-10-02 8:05 PM CT). The table is kept for history only; don't build it.**
| Cap | Proposed | Reasoning |
|---|---|---|
| Per purchase | **600 NP** | Apex (550) must fit; +50 headroom; still blocks fat-finger or catalog-error orders. One cache per order. |
| Daily NP spend / identity | **1,500 NP** (same as MC) | Allows Apex ×2 + Winged in a day. A ranked player online 6 h earns ~290 NP/day + passive, so the cap only brakes hoards (e.g. the ported 1,127 / 850 balances). |
| Daily orders / identity | **10** | Same as MC; caches already have a 5-min per-box cooldown. |
| Per-cache daily limit | **Apex 2/day; every other cache 5/day** | Apex is the top-value box. Others are bounded by the NP cap anyway. |
| Day boundary | America/Chicago | Same as MC. |
- Recommend the ARK and MC daily caps be **separate per provider**, enforced in the worker **inside the debit transaction after the per-identity lock** (see PR #689 Round 2 finding R2-1: the Postgres buy path must enforce them, not only the memory path).

**4. SUPERSEDED by the owner's 8:14 PM CT flat-credit decision (see §4 and LEDGER ANSWER: legacy-bank-flat). Kept for history only; don't build the diff.** Legacy bank balances: NOT covered by the 2026-09-21 port (as far as the box shows) → UNKNOWN amounts.**
- The port doc lists only ArkShop points-table balances for 4 players, plus 3 unported unknown-EOS rows (34 / 30 / 10) (`ARKSHOP_POINTS_PORT_2026-09-21.md:8-15`). It never mentions `ark-nexus-bank`. Points deposited into the bank JSON had left the ArkShop table, so they were most likely **not** ported.
- Proposal: (a) read-only export of the `ark-nexus-bank` store from Citadel; (b) a diff against the port table and the ledger (look for `arkshop-migrate-2026-09-21-add:*` keys) so nothing is counted twice; (c) owner approves the exact list; (d) one admin credit per identity with idempotency key **`legacy-bank-port:<econId>`** (econId, not Discord id, so linked alts can't claim twice), source `legacy-bank-port`, metadata = bank file hash + EOS + amount. Use the same process for the 3 unported unknown-EOS rows once they're matched to an identity.

**5. Refunds: keep both for ARK (PROPOSED).**
- **14-day auto-refund** for PAID/PLAYER_OFFLINE orders with nothing sent: Rewards Ascended needs the player online on one map, so offline players need a safe window, and 14 days matches MC.
- **10 staff refunds per staff member per day:** the player base is small, so 10 is ample. Keep an alert at 5/day per actor (WARDEN W-B4 precedent), refunds only from SENT_UNCONFIRMED/DELIVERY_FAILED after checking the RA log, a required reason, no self-refund, and 365-day audit.

## OWNER DECISIONS (all YES, owner 2026-10-02 8:05 PM CT)
1. **Bank = `/points` balance view, no deposit/withdraw.** **YES.**
2. **Delivery = Rewards Ascended via Sentinal**, EOS-targeted, current map. **YES.**
3. **Starter kits:** ARK and MC kits independent (one each per identity). **YES.**
4. **Kit `OnlyFromSpawn`:** drop it. **YES.**
5. **Money gate:** narrow `NEXUS_ECONOMY_NP_SHOP_WRITES_ENABLED` vs global WRITES. **YES.**
6. **Build order:** stack on #689 with one PR. **YES.**
7. Cache prices 1:1, review after 30 days. No shop caps. Legacy bank: flat 1,500 NP per eligible human (revised 8:14 PM CT; was 'approved list'). **Concept only; the list, count, total and run are unapproved.** Kit free with notional 150 NP. 14-day auto-refund and 10/day staff cap kept. Weekly cache retired. (8:05 PM CT)

## OPEN OWNER ITEMS: legacy-bank-flat (WARDEN, ~8:25 PM CT; none assumed)
1. Approve the separate one-shot gate (`NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH` plus the run-once marker) in place of the shop writes flag.
2. Confirm that `restricted` (quarantined) identities are excluded. Decide the duplicate-human case: `econ_legacy_064c274f…` shares Discord id `143909213712809984` with the owner's identity, and both rows are held.
3. Confirm the fixed `snapshotAt` = 2026-10-02 20:14 CT.
4. After the dry-run, approve the exact list hash, N and total (the hard ceiling), and record `ownerApprovalRef`.
5. Reversal policy if a wrongly credited 1,500 NP has already been spent: debit to a negative balance, partial reversal, or leave it.
6. Resolve each `duplicate_human` row by hand.

## OWNER-ITEM DECISIONS: legacy-bank-flat (NEXUS DIRECTOR, within owner scope, 2026-10-02 ~8:25 PM CT)
- The separate one-shot gate is approved (item 1).
- Quarantined (`restricted`) identities are **excluded** (item 2, first half).
- Snapshot `snapshotAt` = 2026-10-02 20:14 CT is approved (item 3).
- Spent wrong credit (item 5): **no negative balances and no automatic clawback.** Flag the case to the owner; any reversal is a manual, audited, once-only admin debit the owner decides.
- Still owner-only, shown on the dry-run list before anything runs: the held `duplicate_human` case `econ_legacy_064c274f…` (item 2, second half), the exact list hash, N and total (item 4), and each held row (item 6).

## WARDEN BUILD CONDITIONS: legacy-bank-flat (re-review 2026-10-02; W-LB-1..3 CLOSED; CONDITIONAL APPROVE to build, NOT to run)
FORGE must satisfy these and GATEKEEPER verifies them in the PR:
- **(a) Completion lock:** a `COMPLETE` marker in `nexus_economy_batches` makes every later run refuse, even with the same hash. Gap-filling is allowed only while the marker is incomplete.
- **(b) Fail closed** on: a missing env, a hash mismatch, a recomputed N or total above the approved ceiling, or a denylist read error.
- **(c) Secrets in logs:** the approved hash is compared in constant time and never logged in full (prefix only). The denylist is stored as hashes only.
- **(d) Required tests:**
  1. A swapped identity with the same N is refused.
  2. A `restricted` identity is skipped.
  3. `duplicate_human` rows are held on both sides.
  4. A link made after the snapshot is skipped.
  5. A re-run after `COMPLETE` is refused.
  6. A crash mid-run resumes with no double credit.
- **(e)** The LEDGER section below is **SUPERSEDED** where it conflicts with §4. Build from §4 and this section only.

## LEDGER ANSWER (HISTORICAL; SUPERSEDED where it conflicts with §4, do NOT build from this section): legacy-bank-flat credit (2026-10-02, owner decision 8:14 PM CT)
> ARCHITECT note (~8:25 PM CT): WARDEN W-LB-1..3 supersede two lines below. **Restricted identities are NOT eligible** (W-LB-1), and the **gate is the one-shot approved-hash env plus the run-once marker, not the ARK shop writes flag** (W-LB-2). Also, the run matches on a recomputed full-row hash, not just count/total. See §4. LEDGER's text is kept as written.

- **Entry:** `type=credit`, `currency=NEXUS_POINTS`, `amount=1500`, new **source/reason code `legacy_bank_flat`**. Do **not** reuse `system_grant`: that gate is Coins-only with a hardcoded allow-list and must never carry NP.
- **Shape:** a one-shot **admin migration batch**, not a live endpoint. Metadata: `{ batchId, snapshotAt, ownerApprovalRef, dryRunListHash }`. Idempotency key `legacy-bank-flat:<econId>` (unique). A re-run is a no-op.
- **Source account:** a **mint**, recorded against a named issuer/contra account `system:mint:legacy-bank-flat`. That way total issuance is reconcilable (contra balance = −1500 × grants). No treasury exists, and inventing one adds no control.
- **Caps:** none rolling (consistent with the owner's no-caps decision). Instead a **one-shot batch guard**: per-grant ceiling exactly 1500, and the run refuses to start unless the eligible count and total match the owner-reviewed dry-run list (count × 1500) at that list's hash. Re-running only fills gaps.
- **Eligibility:** econIds with a **verified EOS link as of `snapshotAt`** (frozen in the dry-run list). Links made after the snapshot don't qualify, which stops link-farming once this is announced. One grant per econId, even with multiple EOS. Excludes WARDEN Q-01 quarantine denylist **and** `disabled`. Restricted identities with a verified EOS are eligible.
- **Gate:** runs only when the ARK shop writes flag is on and the owner has approved the dry-run list. Reversal = auditable admin debit referencing the original key.
