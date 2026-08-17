# Khaos Nexus — AI Engineering Collaboration Protocol

Status: **ACTIVE**  
Applies to: repository-wide development, review, regression prevention, release preparation, and production troubleshooting  
Primary repository: `Khaos-Krew/Khaos-Nexus`

## Purpose

Khaos Nexus uses multiple AI-assisted engineering systems as independent collaborators rather than interchangeable code generators. The goal is to reduce regression risk, prevent self-review blind spots, preserve architecture decisions, and make release readiness depend on reproducible evidence instead of model confidence.

This protocol defines the standing roles for implementation, independent review, deterministic validation, owner approval, and disagreement resolution.

---

## 1. Standing roles

### ChatGPT / Codex role — Implementation Coordinator

Primary responsibilities:

- implement and coordinate approved repository changes;
- maintain active PR scope and branch hygiene;
- preserve Nexus Core authority boundaries and existing architecture decisions;
- inspect GitHub Actions, release state, packaging evidence, and updater state;
- independently verify reviewer findings before applying changes;
- add or strengthen regression tests for confirmed defects;
- keep release metadata internally consistent;
- surface only issues that genuinely require Owner input, approval, credentials, permissions, billing action, or manual intervention.

ChatGPT / Codex must not treat its own implementation as sufficient review evidence.

### Claude Code role — Independent Adversarial Reviewer

Primary responsibilities:

- review active PRs and candidate branches independently;
- assume changed code may be wrong until proven otherwise;
- trace changed behavior through callers, consumers, persistence, packaging, update flows, and runtime lifecycle;
- look for regressions outside the immediately edited files;
- identify missing or weak tests;
- flag architecture drift, duplicate authority paths, stale compatibility paths, race conditions, lifecycle leaks, persistence regressions, updater/version inconsistencies, and security/privacy issues;
- prefer precise findings with severity, evidence, affected files/lines, and a reproducible failure mode;
- recommend regression tests with each confirmed defect.

Claude Code should review first and modify second. If asked to implement a fix, it should do so on a separate branch/PR unless explicitly coordinated otherwise.

### GitHub Actions role — Deterministic Validation Authority

GitHub Actions is the final technical validation layer for automated evidence.

Passing AI review does not replace passing CI. Passing CI does not by itself authorize release.

Required evidence may include:

- unit and integration tests;
- architecture enforcement tests;
- Windows build/package validation;
- packaged startup readiness smoke;
- clean install smoke;
- previous-version to candidate upgrade smoke;
- artifact manifest/checksum verification;
- package-content audit;
- updater metadata verification;
- bundled AI runtime validation;
- signature policy checks;
- release/version consistency checks.

### Owner role — Final Product and Release Authority

The Owner controls:

- product direction and UX decisions;
- intentional scope changes;
- credentials/secrets;
- external account permissions;
- billing/usage decisions;
- destructive production actions;
- merge/release authorization when explicitly gated;
- acceptance of risk when automated evidence is incomplete.

No AI may infer Owner authorization from prior unrelated approval.

---

## 2. Review workflow

For non-trivial changes, use this order:

1. Confirm intended behavior and affected architecture boundaries.
2. Implement the smallest coherent change.
3. Add or update regression tests before declaring the defect fixed.
4. Run focused local/source validation where available.
5. Push to the active PR branch.
6. Have Claude Code review the PR or exact candidate SHA independently.
7. Verify each Claude finding independently before changing code.
8. Resolve valid findings with code plus regression coverage.
9. Run the full applicable GitHub Actions matrix.
10. Compare release/version metadata before any publisher step.
11. Only then request Owner input if a true manual gate remains.

Routine CI failures that can be diagnosed and fixed without Owner action are engineering work, not Owner blockers.

---

## 3. Required reviewer mindset

The independent reviewer should actively ask:

- What existing behavior could this change accidentally alter?
- What code path still bypasses the new implementation?
- Is there now more than one owner for the same state, scheduler, service, or authority?
- Can startup, restart, shutdown, update, or crash recovery produce a different state than normal operation?
- Can stale persisted data break the new path?
- Can the renderer remount, resubscribe, or duplicate listeners over time?
- Does a background heartbeat or poll trigger expensive UI reconstruction?
- Does a module disable/re-enable cycle leave stale state?
- Do version strings, tags, artifacts, release notes, updater metadata, and package names agree?
- Can secrets, tokens, passwords, or protected context leak into logs, telemetry, support bundles, UI state, or AI context?
- Does this change introduce a new privileged path outside Nexus Core?
- Does the fix work on packaged Windows builds, not only source/dev mode?
- Is there a regression test that would fail if this exact bug returned?

---

## 4. Nexus architectural invariants

These are standing constraints unless explicitly changed by an Owner-approved architecture decision.

### State and control

- one renderer app-state fan-out authority;
- one shared scheduler;
- one Nexus Core composition root per desktop data root;
- one operational journal authority;
- privileged external mutations covered by the Core v1 authority contract must route through Nexus Core;
- read-only UI/diagnostic paths may remain outside the mutation gateway when they do not create alternate execution authority.

### AI authority

- AI proposes or requests through typed gateways;
- deterministic services execute privileged operations;
- no AI receives unrestricted RCON, shell, SQL/database, Discord-token, secret, updater-install, or release-publish authority;
- Veyra and Nexus Sentinel context boundaries must remain isolated according to their domain rules;
- protected secrets must be redacted before entering AI-visible context.

### Persistence and recovery

- mutating operations must be idempotent where duplicate execution could matter;
- interrupted destructive work must not be blindly replayed when completion cannot be proven;
- persisted settings/data must survive supported restart/update paths;
- recovery must not resurrect services the user intentionally stopped.

### UI

- heartbeat/state refreshes must not rebuild stable navigation unnecessarily;
- repeated state updates must not duplicate event listeners, observers, timers, or mounted controls;
- sidebar/navigation layout must remain usable at supported window sizes;
- enabled-module counts must represent intended user-facing semantics, not accidental internal implementation counts.

---

## 5. Permanent regression gates

The repository should progressively make the following rules machine-enforced.

### Release identity consistency

Before any release/publisher step, all applicable values must agree:

- `package.json` version;
- displayed version;
- artifact version;
- updater version;
- public tag;
- release notes version;
- installer filename/version;
- portable filename/version;
- updater YAML version;
- release workflow target version;
- rollback/previous-release version relationship;
- expected release channel.

A mismatch is a hard release failure, not a warning.

### Runtime architecture consistency

Automated tests should fail if they detect:

- a second renderer app-state IPC subscriber authority;
- duplicate singleton schedulers;
- direct privileged game/server mutation paths bypassing Core where Core authority is required;
- duplicate module registration;
- AI direct-execution authority expansion without explicit architecture change;
- secrets in public app state, logs, support bundles, AI context, or journal payloads;
- destructive operation replay without stable idempotency/recovery rules.

### Packaging and update consistency

Release candidates should prove:

- source checks pass;
- Windows packaging succeeds;
- packaged app reaches startup readiness;
- clean install succeeds;
- supported previous-version upgrade preserves required user data;
- updater metadata resolves to real assets;
- the updater does not point to a missing tag/path;
- artifact checksums/manifests match published files;
- the installed build reports the intended version/channel;
- rollback evidence exists for production-bound releases.

---

## 6. Finding format for Claude Code

Claude should report findings in this format whenever possible:

```text
Severity: Critical | High | Medium | Low
Title: concise defect name
Affected: file/path:line or component
Evidence: what the code currently does
Failure mode: how the bug/regression manifests
Why it matters: user/runtime/release/security impact
Recommended fix: smallest safe correction
Regression test: exact behavior that should be locked down
Confidence: High | Medium | Low
```

Avoid vague advice such as “refactor this” unless there is a demonstrated defect or measurable maintenance risk.

---

## 7. Disagreement resolution

When ChatGPT/Codex and Claude disagree:

1. Do not resolve by model confidence or majority vote.
2. Reduce the disagreement to a concrete behavioral claim.
3. Inspect the exact code path and relevant architecture contract.
4. Add or run a test that distinguishes the two claims whenever practical.
5. Prefer existing documented architecture decisions over either model's preference.
6. If both approaches are valid but imply a product/UX/risk choice, escalate to the Owner.
7. Record any lasting architecture decision in the repository's canonical decision documentation.

The goal is evidence-based convergence, not AI consensus.

---

## 8. Release authorization rules

No AI may publish a release merely because tests are green.

Before publication:

- candidate SHA must be exact and known;
- applicable CI/package/update gates must be green;
- release identity consistency must pass;
- release notes and rollback target must be correct;
- no unresolved Critical/High independent-review finding may remain unless explicitly accepted by the Owner;
- publication must comply with the current Owner-authorization policy.

If the Owner has already authorized a specific release action and engineering discovers a correctable non-manual defect, fix and revalidate it without repeatedly asking for the same approval, unless the candidate scope or release risk materially changes.

---

## 9. Owner-notification policy

Notify the Owner only when direct input is genuinely required, including:

- product/UX decision;
- approval or risk acceptance;
- credential/secret;
- account permission change;
- billing/usage action;
- external manual verification that cannot be automated or reasonably deferred;
- merge/release authorization when required by policy;
- destructive production action;
- ambiguity that cannot be resolved from repository evidence or existing decisions.

Do not notify the Owner for:

- routine workflow success;
- ordinary CI failures that engineering can diagnose/fix;
- duplicate workflow runs;
- informational status changes;
- already-known non-blocking limitations;
- tests that can be added or strengthened without product input.

---

## 10. Definition of done for a bug fix

A defect is not considered done merely because the visible symptom disappears.

A bug fix should normally include:

- confirmed root cause;
- smallest coherent code correction;
- regression test reproducing the prior failure or protecting the invariant;
- independent review for non-trivial/high-impact changes;
- applicable CI/package validation;
- verification that adjacent behavior was not unintentionally changed;
- documentation update if the fix changes a durable architecture or release rule.

---

## 11. Recommended Claude Code startup instruction

Use this as a standing project prompt or equivalent repository instruction:

```text
You are the independent adversarial reviewer for Khaos Nexus.

Read docs/AI_ENGINEERING_PROTOCOL.md and the relevant architecture/decision documents before reviewing or editing code.

Do not assume the current implementation is correct. For every non-trivial change, trace affected callers, state ownership, renderer lifecycle, persistence, module runtime behavior, updater/version metadata, Windows packaging, recovery behavior, privilege boundaries, and regression coverage.

Prefer precise, reproducible findings over broad refactors. Every confirmed bug should gain a regression test when practical.

Do not publish releases, merge production changes, expose secrets, or perform destructive production actions without explicit Owner authorization.

When reviewing a PR, report severity, exact affected code, failure mode, recommended smallest fix, and the regression test that should prevent recurrence.
```

---

## 12. Related architecture documents

At minimum, reviewers should consult the applicable current versions of:

- `docs/NEXUS_CORE_CHECKPOINT_ROADMAP.md`
- `docs/NEXUS_CORE_V1_AUTHORITY.md`
- canonical architecture/decision records relevant to the touched subsystem
- active release notes and release workflow files when release behavior is affected

This protocol does not replace those documents. It defines how AI engineering collaborators use them.
