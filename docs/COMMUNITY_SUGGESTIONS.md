# Khaos Nexus Community Suggestions

## Purpose

The Community Suggestions system keeps member ideas from disappearing into chat or becoming passive roadmap notes. Nexus Sentinal assigns every submission a durable `SUG-####` identifier, keeps the proposal visible in Discord, records the community vote, and moves successful proposals into development review.

## Live workflow

1. A member opens `#suggestions` and uses **Submit Suggestion**.
2. Sentinal creates a tracked suggestion card with a stable ID, category, details, vote counts, and closing time.
3. The submitter cannot vote on their own suggestion.
4. Other members have one vote. They may change it or click the same vote again to remove it.
5. At the end of the voting window, Sentinal evaluates both turnout and approval percentage.
6. Suggestions that do not meet the community gate remain recorded with a **Community Gate Not Met** state.
7. Suggestions that pass enter the development queue.
8. If the GitHub runtime bridge is configured, Sentinal creates a GitHub issue containing the suggestion and vote evidence. If GitHub is not configured or temporarily fails, the suggestion remains durable as **GitHub Pending** and is retried by the periodic reconciler.
9. Community passage is not implementation approval. Owner review is still required before development begins.

## Initial defaults

The first live rollout uses configurable defaults:

- Voting window: **72 hours**
- Minimum turnout: **5 total votes**
- Approval threshold: **60%**

Environment overrides:

- `NEXUS_SUGGESTION_VOTING_HOURS`
- `NEXUS_SUGGESTION_MIN_VOTES`
- `NEXUS_SUGGESTION_PASS_PERCENT`
- `NEXUS_GITHUB_REPOSITORY` (defaults to `Khaos-Krew/Khaos-Nexus`)
- `NEXUS_GITHUB_TOKEN` (optional runtime credential for automatic issue creation)

## Anti-burial guarantees

- IDs are allocated from persistent Sentinal state and survive restarts.
- Discord suggestion posts remain as the member-facing record after voting closes.
- Vote state is persisted rather than inferred from reactions.
- Passed suggestions are never discarded because GitHub is unavailable; they remain in a retryable pending state.
- GitHub issue bodies do not include the submitter's Discord ID or display name.
- The GitHub issue explicitly states that Owner approval is still required before implementation.

## Authority boundaries

- The community decides whether a proposal passes the community vote gate.
- Passing the gate means **development review**, not automatic implementation.
- Nexus ownership retains final approve/deny authority.
- A future acceptance step will connect Owner approve/deny decisions back to the Discord suggestion card with the recorded reason and implementation state.

## Completion target

The core intake, persistence, voting, and development-queue behavior qualifies as the 66% implementation milestone once verified live. The section reaches 100% when the Owner review/decision feedback loop and automatic GitHub development handoff are accepted end-to-end.
