# Khaos Nexus Production Handoffs

This document defines the repository-backed handoff system for the Khaos Nexus Production Project.

## Sources of truth

| Subject | Canonical source |
| --- | --- |
| Existing code, branches, commits, pull requests, tests, and releases | `Khaos-Krew/Khaos-Nexus` |
| Confirmed architecture and platform decisions | [Architecture and Decisions Register](https://docs.google.com/document/d/14lSPuROBAEa8YLe_gPTyyxIiILVik-a0NT_hUkPcYog) |
| Confirmed implementation or validation work | GitHub production handoff issues |
| Implementation changes | A linked branch and pull request |
| Chat discussion | Supporting context only; it is not the final work record |

## Roles

### Input and Routing

- Receives ideas, bugs, requirements, and decisions.
- Checks the repository, current behavior, open issues, open pull requests, project instructions, and the current Decisions Register.
- Separates confirmed requirements from suggestions.
- Creates or updates one production handoff issue.
- Assigns exactly one primary production chat.
- Creates secondary handoffs only when another chat genuinely must act.
- Does not implement application features.

### Product Architecture

- Owns platform-wide architecture direction.
- Maintains branch ownership and resolves overlapping scopes.
- Records confirmed architecture decisions through the Decisions Register process.
- Reviews handoffs that affect shared contracts, security boundaries, data compatibility, release architecture, or multiple modules.

### Production chats

- Open the assigned GitHub issue before planning.
- Confirm the issue's register revision, decision IDs, baseline branch, pull request, and commit.
- Inspect existing code and current behavior.
- Post findings, blockers, scope changes, and completion evidence to the issue.
- Implement only the assigned scope on the approved branch or a branch derived from it.
- Link the implementation pull request to the handoff issue.

## Existing Application Rule

Khaos Nexus is an existing application in active development. It is not a greenfield project.

Before implementation, the assigned production chat must:

1. Inspect the existing code and current behavior.
2. Document what already works.
3. Identify incomplete, broken, duplicated, or outdated parts.
4. Preserve working systems.
5. Extend or repair the existing architecture whenever practical.
6. Avoid a complete rewrite unless repository evidence proves it is necessary.
7. Preserve compatibility with existing data, configurations, integrations, security controls, and user workflows.
8. Record the exact branch, pull request, and commit used as the baseline.

`main` must not be assumed to be the current application-code baseline. The correct baseline depends on the assigned workstream and its branch ancestry.

## Handoff lifecycle

1. **Intake** — Input and Routing receives the request.
2. **Inspection** — Existing code, behavior, issues, pull requests, and decisions are reviewed.
3. **Deduplication** — An existing issue is updated when it already owns the work.
4. **Routing** — One primary chat is selected. Secondary chats are included only when action is required.
5. **Issue creation** — The Production handoff issue form is completed.
6. **Acknowledgement** — The primary chat comments with its coordination check.
7. **Implementation or validation** — Work occurs on the approved baseline.
8. **Evidence** — Tests, screenshots, logs, commits, pull requests, or owner validation are linked.
9. **Completion** — The issue is closed only when the expected result is met or the work is explicitly rejected or superseded.

## Required coordination check

The assigned production chat must post this compact acknowledgement before material planning or implementation:

```text
Coordination check
Register revision: R#
Decision IDs: ADR-### or None
Handoff: #issue
Primary owner: exact production chat
Baseline: branch @ commit, PR #
Conflicts or blockers: None or details
Existing behavior inspected: short evidence summary
```

## Compact chat handoff

After the GitHub issue exists, the cross-chat message should normally be one line:

```text
Route to <Primary Chat> — GitHub issue #<number>. Use the baseline and decisions recorded there; report blockers and completion on the issue.
```

Do not paste the full requirement into multiple chats. The issue is the shared handoff record.

## Label contract

### Owner

- `owner:architecture`
- `owner:desktop-core`
- `owner:diagnostics`
- `owner:release-ci`
- `owner:discord-runtime`
- `owner:discord-studio`
- `owner:discord-onboarding`
- `owner:scheduler`
- `owner:game-adapters`
- `owner:android`
- `owner:dnd`
- `owner:module-center`

Add new owner labels only when a production chat has a distinct, durable scope. Do not create multiple labels for minor subdivisions of the same owner.

### Type

- `type:handoff`
- `type:feature`
- `type:bug`
- `type:decision`
- `type:research`
- `type:architecture`

### Priority

- `priority:low`
- `priority:normal`
- `priority:high`
- `priority:blocking`

### Status

- `status:needs-inspection`
- `status:ready`
- `status:in-progress`
- `status:blocked`
- `status:validation`
- `status:complete`
- `status:superseded`

Each active handoff should normally have one owner label, one priority label, and one status label. Type labels may include `type:handoff` plus the underlying work type.

## Issue update rules

Update the existing issue when:

- the requirement changes without changing the primary owner;
- a dependency, baseline, or decision changes;
- new evidence or a blocker is found;
- implementation moves from inspection to development or validation.

Create a new issue only when:

- a different production chat owns a separately deliverable result;
- the new work can be completed and validated independently;
- combining it would create unclear ownership or duplicated implementation.

Link the issues when one depends on the other.

## Completion evidence

A handoff is not complete merely because code was written. The closing comment must identify:

- the implemented or validated result;
- the branch and final commit;
- the linked pull request;
- tests or owner validation completed;
- compatibility and migration effects;
- remaining follow-up issues;
- the Decisions Register update required, if any.
