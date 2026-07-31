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
- Records Owner answers and test observations in the applicable GitHub issue or decision record.

### Product Architecture

- Owns platform-wide architecture direction.
- Maintains branch ownership and resolves overlapping scopes.
- Records confirmed architecture decisions through the Decisions Register process.
- Reviews handoffs that affect shared contracts, security boundaries, data compatibility, release architecture, or multiple modules.
- Defines when Owner participation is genuinely required and the approved test-distribution path.

### Production chats

- Open the assigned GitHub issue before planning.
- Confirm the issue's register revision, decision IDs, baseline branch, pull request, and commit.
- Inspect existing code and current behavior.
- Own implementation, diagnostics, automated testing, CI review, defect repair, release preparation, and evidence management for the assigned scope.
- Post findings, blockers, scope changes, and completion evidence to the issue.
- Implement only the assigned scope on the approved branch or a branch derived from it.
- Link the implementation pull request to the handoff issue.
- Exhaust available automated and repository-based validation before requesting Owner participation.

## Assistant-led development and Owner-limited participation

ADR-006 establishes the permanent operating model for Khaos Nexus.

### Production-agent responsibilities

Production agents own:

- repository inspection and current-behavior analysis;
- architecture, planning, implementation, refactoring, and defect repair;
- automated, integration, packaging, artifact, signature, and checksum validation;
- diagnostics, security review, evidence interpretation, and defect triage;
- GitHub issue, branch, pull-request, and cross-chat coordination;
- release preparation and approved test-candidate publication requests;
- conversion of Owner observations into structured evidence and follow-up work.

The Owner must not be asked to edit code, build locally, manage branches or pull requests, resolve merge conflicts, inspect CI internals, interpret diagnostics, assemble releases, select artifacts, or decide which production chat owns a defect.

### Owner responsibilities

The Owner remains the final product authority. Owner participation is limited to:

- answering focused questions that cannot be resolved from repository or project evidence;
- running an approved build on physical hardware, a private desktop environment, or a privately reachable live server;
- reporting visible results, screenshots, logs, or exported support bundles;
- approving material product decisions and final release promotion.

The Owner retains control of private credentials, private environments, destructive operations, and final product acceptance.

### Owner question gate

Before asking the Owner a question, the assigned production chat must:

1. Inspect the repository, current behavior, relevant issues and pull requests, project instructions, and current Decisions Register.
2. Confirm the answer cannot be resolved safely from existing evidence.
3. Avoid repeating a question already answered elsewhere.
4. Ask one focused question and explain why the answer is required.
5. Provide concrete options when known.
6. Record any implementation-affecting answer on the applicable GitHub issue or decision record.

Questions should be batched when practical. While an Owner answer is required, use `status:blocked` and post an **Owner question request** comment containing the exact issue, reason, focused question, known options, and implementation or release impact.

### Owner test-session gate

Owner execution is permitted only after available automated, static, integration, packaging, artifact, signature, checksum, and repository-based validation is exhausted.

Every Owner test request must include:

- why physical or private execution is necessary;
- exact GitHub issue and feature under test;
- exact version, branch, pull request, and commit;
- approved installation path and artifact or update channel;
- checksum and signing identity;
- backup and rollback state;
- a short numbered checklist with expected results;
- clear stop conditions;
- one simple evidence-return method.

Use `status:validation` and post an **Owner test session** comment containing these fields. Windows application tests must use the approved in-app Owner-test channel once established by issue #90. Android tests must use a verified APK with exact checksum and signing evidence. Do not request a repeated test of an unchanged binary unless the environment changed and the reason is recorded.

A failed Owner test returns to assistant-led diagnosis, repair, automated validation, and publication of a changed candidate before another Owner session.

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
7. **Implementation or validation** — Production agents perform the engineering work on the approved baseline.
8. **Automated evidence** — Available tests, CI, packaging, artifacts, signatures, checksums, and diagnostics are completed and recorded.
9. **Owner exception gate** — A focused Owner question or physical/private test is requested only when unresolved evidence requires it.
10. **Evidence conversion** — Production agents convert Owner observations into structured issue evidence, defects, and follow-up work.
11. **Completion** — The issue is closed only when the expected result is met or the work is explicitly rejected or superseded.

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
Automated validation completed: current evidence or Not started
Owner action required: No, Owner question, Physical/private validation, or Final approval
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

`status:blocked` is used when a focused Owner answer or another dependency is required. `status:validation` is used for an approved Owner physical/private test session after automated validation and candidate publication are complete.

Each active handoff should normally have one owner label, one priority label, and one status label. Type labels may include `type:handoff` plus the underlying work type.

## Issue update rules

Update the existing issue when:

- the requirement changes without changing the primary owner;
- a dependency, baseline, or decision changes;
- new evidence or a blocker is found;
- implementation moves from inspection to development or validation;
- an Owner question, Owner test session, or Owner-reported result affects the same deliverable.

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
- automated tests, CI, artifact, signature, checksum, and diagnostics evidence completed;
- Owner validation completed when physical or private execution was required;
- compatibility and migration effects;
- remaining follow-up issues;
- the Decisions Register update required, if any.

Production agents are responsible for interpreting and organizing the evidence. The Owner is responsible only for reporting the requested observations and granting final approval where required.
