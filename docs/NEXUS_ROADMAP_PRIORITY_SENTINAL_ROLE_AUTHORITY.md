# Nexus Roadmap Priority — Sentinal Unified Role Authority

Status: **P0 / PRIORITY — IN PROGRESS**  
Roadmap area: **Sentinal operational acceptance**  
Blocking: **Real-guild Discord acceptance**

## Objective

Nexus Sentinal must become the single active authority for Khaos Nexus self-service Discord roles. The old Khaos Nexus reaction-role system must be migrated into Sentinal and retired after the replacement controls are verified healthy.

This work is not complete until the legacy reaction-role migration is live and accepted on the intended Discord guild.

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
- **PR #330 — merged:** deep legacy discovery across role-related channels and bounded guild fallback scanning. Live owner-test deployment scanned 146 text channels / 1,160 messages and confirmed the visible legacy menus are not the later `kn-role` button format.
- **PR #331 — open:** legacy emoji reaction-role migration, including reaction-to-role mapping, refusal of ambiguous imports, conversion to Sentinal buttons, and color-menu conversion.

## Acceptance criteria

This priority remains **IN PROGRESS** until all of the following are true:

- [ ] PR #331 or its superseding implementation passes the full Nexus Rebuild CI gate and is merged.
- [ ] Railway-hosted Sentinal deploys the merged implementation successfully.
- [ ] Sentinal discovers the actual legacy reaction-role menus on the intended guild.
- [ ] Every safely migrated menu publishes a working Sentinal replacement using the existing Discord roles.
- [ ] Normal self-role buttons add/remove only their intended roles.
- [ ] Selecting a new name color removes the previous selectable color and visibly changes the member's Discord name color when no higher protected colored role overrides it.
- [ ] Color-role hierarchy remains below staff/moderation authority and above ordinary selectable/supporter/module roles.
- [ ] Old Khaos Nexus reactions/buttons are retired only after replacement validation succeeds.
- [ ] No duplicate roles or duplicate active role menus remain.
- [ ] Restart/reconciliation preserves the migrated menus and role mappings.
- [ ] Owner acceptance is recorded on the real guild.

## Priority rule

Do not mark Sentinal Discord role management as fully accepted while this item is incomplete. New self-service role features should extend this unified role authority instead of creating a second role-management path.
