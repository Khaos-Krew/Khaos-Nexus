# Khaos Nexus Poll System Plan

Status: Approved planning baseline; implementation follows Discord + Nexus Setup Acceptance unless needed by an active acceptance workflow.

## Goal

Build one backend-first Nexus Poll Engine that Nexus Sentinal can use for community polls, suggestion voting, event scheduling, staff decisions, and future governance workflows. Do not create separate voting implementations for each feature.

## Architecture

### Nexus Poll Engine

The backend owns poll state, eligibility, vote validation, closing rules, result calculation, audit metadata, and automation hooks. Discord is the primary user interface through Nexus Sentinal.

Initial components:

- `poll-model.cjs` — poll schema, validation, identifiers, lifecycle states, decision rules.
- `poll-store.cjs` — persistent state under `NEXUS_DATA_DIR` using atomic writes.
- `poll-engine.cjs` — vote casting, eligibility, quorum, thresholds, ties, open/close/cancel/runoff behavior.
- `poll-extension.cjs` — Discord commands, embeds, buttons/select menus, scheduled reconciliation, result publication.
- `poll-profiles.cjs` — reusable policy profiles for Community, Suggestions, Events, Staff, and Governance.
- `poll-native-adapter.cjs` — optional Discord-native poll support for simple informal polls only.

The existing Community Suggestions vote flow should migrate onto this shared engine without changing its current approved behavior.

## Poll record

Each poll should contain:

- Poll ID such as `POLL-0042`.
- Question/title.
- Optional description/context.
- 2–10 answer options initially.
- Creator ID and creation source.
- Discord guild/channel/message IDs.
- Poll profile/type.
- Status: `scheduled`, `open`, `closed`, `cancelled`, or `runoff`.
- Open and close timestamps.
- Vote visibility mode.
- Whether multiple selections are allowed.
- Maximum selections when multi-select is enabled.
- Eligible role IDs and optional excluded role/user IDs.
- Optional creator/self-vote exclusion.
- Minimum votes/quorum.
- Decision rule.
- Passing threshold when applicable.
- Tie rule.
- Vote records or privacy-preserving voter records.
- Final immutable result snapshot.
- Audit timestamps and actor IDs for administrative actions.
- Optional source linkage such as Suggestion ID, Event ID, or GitHub issue.

## Decision rules

Support these rules from the first shared engine:

1. **Plurality** — option with the most votes wins.
2. **Majority** — winner must exceed 50% of valid votes.
3. **Threshold** — a specified option passes when it reaches the configured percentage and quorum.
4. **Supermajority** — configurable elevated threshold such as 66% or 75%.
5. **Informational** — no automatic winner; results are published for community feedback.

Tie behavior is configurable per profile:

- automatic runoff;
- Owner/staff review;
- no decision;
- keep poll open for a configured extension when allowed.

## Default poll profiles

### Community Pulse

For general community questions and preference checks.

- Staff-created initially.
- Public eligibility unless roles are specified.
- Plurality or informational result.
- Visible running totals by default.
- Typical duration: 24–72 hours.

### Yes/No Decision

For binary community decisions.

- Quorum required.
- Majority or configurable threshold.
- Can hide running results until close.
- Creator exclusion optional.

### Suggestion Gate

Must preserve current approved Suggestions behavior:

- Suggestion submitter cannot vote on their own suggestion.
- One changeable vote per eligible member.
- Minimum 5 votes by default.
- 60% approval by default.
- 72-hour default window.
- Passing poll continues to GitHub planning/review workflow.
- Failing poll closes publicly with the result.
- Owner implementation approval remains a separate protected gate.

### Event Scheduling

For choosing dates, times, games, activities, or formats.

- Multi-select supported.
- Eligible event/community role filters supported.
- Plurality or top-N result.
- Can feed the chosen result directly into Nexus Sentinal Event Management.

### Staff Decision

For internal operational voting.

- Current authorized staff only.
- Results hidden until close by default.
- Voter identities restricted from normal members.
- Majority/supermajority selectable.
- Audit trail retained for authorized staff.

### Nexus Governance

For higher-impact community or ecosystem decisions.

- Owner/authorized management creation only.
- Explicit quorum and threshold required.
- Running results hidden by default.
- Immutable final result snapshot.
- No automatic high-impact action solely from a public vote; required Owner/Community Manager approval remains authoritative where the surrounding workflow requires it.

## Discord UX

### Canonical channel

Sentinal should maintain/adopt one `#polls` channel in the appropriate community area instead of creating duplicates. The channel should be read-only for ordinary message posting while members can interact with managed poll controls.

### Commands

Initial command surface:

- `/poll create` — authorized poll builder.
- `/poll status` — show current state and eligibility.
- `/poll results` — show results when policy permits.
- `/poll close` — authorized early closure.
- `/poll cancel` — authorized cancellation with reason.
- `/poll list` — active/recent managed polls.

The builder should collect:

- question;
- options;
- profile;
- duration/open/close time;
- anonymous/visibility mode;
- multi-select behavior;
- eligible roles;
- quorum/threshold where the profile allows customization;
- creator-exclusion choice.

### Voting controls

- Yes/No or very small polls can use buttons.
- Multi-option polls use select menus.
- Members can change or remove a vote while the poll is open unless a profile explicitly locks votes.
- Responses acknowledge the member privately and update the canonical public card.
- Closed polls disable controls and display an immutable result summary.

## Privacy

Support three visibility modes:

1. `public` — running totals are visible.
2. `results-after-close` — totals hidden until closure.
3. `anonymous-results` — public output never exposes voter identities.

Even anonymous polls must retain enough internal identity information to enforce one-vote/eligibility rules. Identity data should not be included in public embeds, logs, patch notes, or result exports. A future storage migration may pseudonymize voter IDs where a permanent identity audit is unnecessary.

Native Discord polls are therefore not the authoritative implementation for anonymous or governance polls.

## Eligibility and anti-abuse

- Ignore bot accounts.
- One vote record per user per poll, with multi-select choices stored within that record.
- Role eligibility evaluated against current Discord membership/roles at vote time.
- Optional creator exclusion.
- Optional excluded users/roles.
- Do not award Community XP merely for casting a poll vote; this avoids vote farming.
- Rate-limit vote mutation and poll creation interactions.
- Initially restrict generic poll creation to authorized staff; ordinary members use Suggestions for community proposals.
- No user can manipulate vote totals through reactions or ordinary channel messages.

## Lifecycle

1. Draft/build.
2. Validate profile and permissions.
3. Create immediately or schedule.
4. Publish one canonical managed poll card.
5. Accept validated votes.
6. Reconcile/update display without duplicating messages.
7. Send optional reminders based on profile.
8. Close automatically at deadline or by authorized action.
9. Compute quorum, result, threshold, and tie handling.
10. Persist immutable final snapshot.
11. Publish final result.
12. Trigger the workflow hook, if any.
13. Retain audit metadata and archive according to retention policy.

## Workflow hooks

The Poll Engine exposes typed completion hooks rather than hard-coding feature behavior inside the vote handler.

Examples:

- `suggestion` → Community Suggestions evaluation/GitHub planning workflow.
- `event` → proposed date/activity becomes an Event Management draft.
- `content-creator` → future application/community-feedback workflow where appropriate.
- `governance` → management review queue; never bypass required Owner/Community Manager approval.

## Native Discord poll adapter

Discord-native polls are useful for quick informal public questions. Nexus may optionally create them for a `native/informal` profile, while the custom Nexus Poll Engine remains authoritative for controlled workflows.

Use the native adapter only when the requested policy fits Discord's native poll capabilities. Do not use it when Nexus needs anonymous results, custom quorum/threshold enforcement, creator exclusion, specialized role eligibility, workflow automation, or a protected audit/result contract.

## Acceptance tests

### Unit/contract

- ID/schema validation.
- 2–10 options and duplicate-option rejection.
- Single- and multi-select vote mutation.
- One voter record per user.
- Self-vote exclusion.
- Role eligibility and excluded roles/users.
- Quorum calculations.
- Majority/threshold/supermajority/plurality behavior.
- Tie/runoff behavior.
- Closing freezes votes.
- Cancellation cannot produce a winner.
- Anonymous/public render contracts.
- Suggestions profile exactly preserves current 5-vote/60%/72-hour default behavior.
- Automation hook fires exactly once after finalization.

### Discord/live

- `#polls` is adopted idempotently and does not duplicate.
- Normal member cannot post ordinary messages if the channel is managed read-only.
- Authorized creator can build a poll.
- Unauthorized creator is rejected privately.
- Eligible member can vote/change/remove vote.
- Ineligible member is rejected privately.
- Multi-select limits are enforced.
- Hidden-result polls do not leak running totals.
- Auto-close publishes the correct final result once.
- Restart preserves active polls and timers/reconciliation.
- Closed controls cannot mutate the result.
- Suggestions migration completes a real end-to-end suggestion without behavior regression.

## Implementation sequence

### Phase 1 — Shared core

Build model, store, rules engine, profiles, deterministic tests, and persistence/restart handling.

### Phase 2 — Sentinal Discord UI

Build `#polls`, `/poll` commands, managed cards, buttons/selects, authorization, scheduled closure, and result publication.

### Phase 3 — Suggestions migration

Move Community Suggestions to the shared engine while preserving self-vote prevention, 72-hour voting, minimum 5 votes, 60% pass threshold, GitHub handoff, development-plan gate, and Owner approval/denial flow.

### Phase 4 — Advanced controls

Add hidden/anonymous results, role-gated audiences, reminders, runoffs, and administrative audit views.

### Phase 5 — Event/governance integration

Connect the shared Poll Engine to Sentinal Event Management and other approved governance workflows.

### Phase 6 — Optional native adapter

Add Discord-native poll creation for informal polls where the native feature is a clean fit. Keep Nexus-managed polls authoritative for controlled workflows.

## Definition of done

The poll system reaches 100% only when:

- the shared engine is the single source of truth for Nexus-managed voting;
- Sentinal manages the canonical Discord poll surface idempotently;
- Suggestions use the shared engine without regression;
- authorization, privacy, quorum, threshold, tie, restart, and close behavior have automated coverage;
- a real normal-member poll lifecycle has been accepted in Discord;
- a real Suggestions lifecycle has passed through the shared poll engine and its protected Owner review gate.
