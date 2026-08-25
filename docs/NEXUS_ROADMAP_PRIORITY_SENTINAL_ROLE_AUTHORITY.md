# Nexus Roadmap Priority — Sentinal Unified Role Authority

Status: **P0 / AUTOMATED GREEN — HUMAN ACCEPTANCE PENDING**  
Roadmap area: **Sentinal operational acceptance**  
Blocking: **Real-guild interaction acceptance only**

## Objective

Nexus Sentinal is the single active authority for Khaos Nexus self-service Discord roles. The old Khaos Nexus reaction-role system is migrated into Sentinal only when its options can be mapped safely to existing roles; unsafe or ambiguous legacy controls are preserved for review instead of guessed.

The implementation and hosted runtime are green. Final acceptance remains intentionally human-gated because a real member must still prove button add/remove behavior and visible Discord role presentation from the client side.

## Required behavior

- Sentinal owns all Khaos Nexus self-service role menus, not only game-module access roles.
- Existing Discord roles are adopted rather than duplicated.
- Game/module access roles remain automatically reconciled as modules are enabled or added.
- Platform, game, notification, pronoun, and other ordinary self-roles remain independent toggles unless a menu is explicitly exclusive.
- Name-color roles are exclusive: choosing a new color removes the member's previous selectable name-color role.
- Name-color roles receive safe Discord hierarchy priority above normal self-service, module-access, and supporter roles so the selected name color is actually displayed.
- Administrator, moderation, integration-managed, and otherwise protected roles remain above the selectable color layer and are never lowered merely to force a display color.
- Legacy Khaos Nexus reaction-role messages are detected and mapped only when every option can be resolved safely to an existing Discord role.
- Ambiguous or partially mapped legacy menus are left untouched and reported rather than guessed.
- Old reactions/buttons are removed or retired only after the replacement Sentinal menu is active and verified.
- Sentinal must not create duplicate generic/self-service roles while adopting the old system.

## Current implementation state

- **PR #329 — merged:** unified Sentinal self-role framework, exclusive color semantics, safe color-role hierarchy planning, existing-role adoption, legacy button compatibility, and replacement-menu state persistence.
- **PR #330 — merged:** deep legacy discovery across role-related channels and bounded guild fallback scanning.
- **PR #331 — merged 2026-08-24:** legacy emoji reaction-role migration, including reaction-to-role mapping, refusal of ambiguous imports, conversion to Sentinal buttons, and color-menu conversion. Merge commit: `0dd7a1a29d8536719ba54561accf10cf39472f43`.
- **Hosted role/access preflight — green 2026-08-25:** 16 modules represented, 15 Sentinal-ready plus D&D correctly delegated to Veyra, 16 access roles, 16 button bindings, 0 attention, 0 pending, and 3 staff authority roles.
- **Name-color planning — green:** 32 selectable colors are recognized; protected/staff authority remains above the selectable color layer.
- **Native Discord Community Onboarding conflict — resolved:** native Onboarding is disabled while its saved prompts/default-channel configuration remains intact. Sentinal's `#welcome` / role flow is authoritative so NEXUS HQ can remain genuinely Shadow Recruit+ instead of requiring `@everyone` writable community channels.
- **Topology reconciliation concurrency — hardened:** slow Discord API passes are serialized/coalesced so the periodic reconciler cannot overlap an in-flight startup pass.

## Acceptance criteria

### Automated / hosted acceptance

- [x] PR #331 or its superseding implementation passes the Nexus Rebuild CI gate and is merged.
- [x] Railway-hosted Sentinal deploys the merged implementation successfully.
- [x] Module access preflight reports all 16 module bindings with 0 attention and 0 pending.
- [x] Color-role hierarchy policy remains below staff/moderation authority and above ordinary selectable/supporter/module roles.
- [x] Ambiguous legacy mappings fail closed rather than creating guessed or duplicate roles.
- [x] Restart/reconciliation preserves role mappings and replacement menus.
- [x] Slow topology reconciliation is serialized so startup and periodic passes cannot overlap.

### Real-guild interaction acceptance

- [ ] A normal member presses a module-access button and receives only the intended access role/category.
- [ ] Pressing the same/remove control removes only that intended role/category while unrelated game categories remain isolated.
- [ ] A normal self-role button adds/removes only its intended role.
- [ ] Selecting a new name color removes the previous selectable color and visibly changes the member's Discord name color when no higher protected colored role overrides it.
- [ ] A staff account and a normal member account confirm the STAFF workspace visibility boundary from Discord's client UI.
- [ ] Any remaining legacy reaction-role controls visible in the guild are confirmed migrated or deliberately retained because they could not be mapped safely.
- [ ] Owner acceptance is recorded on the real guild.

## Priority rule

Do not mark broad Discord roles + permissions acceptance at 100% until the real-guild interaction checks above are completed. New self-service role features must extend this unified role authority instead of creating a second role-management path.
