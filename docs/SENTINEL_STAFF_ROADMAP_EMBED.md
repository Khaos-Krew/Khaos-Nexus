# Nexus Sentinel — Staff Roadmap Embed

Status: **PLANNED / S1A STAFF WORKSPACE REBUILD**

## Purpose

Provide staff with a read-only Discord roadmap surface that is continuously synchronized with the Khaos Nexus canonical roadmap and implementation evidence. The roadmap must be understandable at a glance on desktop and mobile without requiring staff to inspect GitHub.

## Discord placement

Create a staff-only text channel under the Staff Hub category:

- Preferred name: `#nexus-roadmap`
- Alternate acceptable name: `#staff-roadmap`
- Channel is read-only for normal staff except for authorized administrators/Sentinel.
- Nexus Sentinel owns and updates the persistent roadmap message.

## Persistent roadmap message

Use one persistent Discord message composed of three status embeds so the status colors are real embed colors rather than only text labels:

1. **Complete** — green embed
2. **In Progress** — orange embed
3. **Not Started** — red embed

Each roadmap item must appear in exactly one status embed at a time.

Suggested visual status markers may also be included for mobile scanning:

- 🟢 Complete
- 🟠 In Progress
- 🔴 Not Started

## Synchronization behavior

- Sentinel must update the existing roadmap message instead of posting a new message for every change.
- Roadmap state is derived from the canonical roadmap/status source plus repository evidence; chat memory alone is not authoritative.
- When an item transitions from not started to in progress, Sentinel moves it from the red embed to the orange embed.
- When an item is accepted as complete, Sentinel moves it from orange to green.
- If implementation exists but owner acceptance or required validation is incomplete, the item remains orange rather than green.
- Do not mark an item complete merely because code was committed.
- Include a `Last updated` timestamp and, when useful, current build/version identity.
- Keep the displayed roadmap concise; group detailed implementation tasks beneath their phase/module rather than flooding the channel with every commit.
- If Discord embed field limits are exceeded, split a status section into additional embeds while preserving the same status color.

## Update triggers

Refresh the roadmap message after meaningful roadmap state changes, including:

- roadmap phase begins;
- roadmap phase completes;
- a planned feature begins implementation;
- acceptance/validation changes an item's state;
- a feature is deferred, rejected, or returned to work;
- canonical roadmap status is updated;
- accepted release/build identity materially changes the roadmap view.

Routine commits that do not change roadmap status do not require a Discord refresh.

## Staff-facing content rules

- Show feature/phase names, concise descriptions, and current state.
- Keep implementation secrets, credentials, tokens, private account information, and protected diagnostics out of the embed.
- Do not expose private-edition-only functionality on the staff roadmap.
- Do not expose raw GitHub internals that staff do not need to understand current progress.

## Recommended interaction controls

The roadmap itself should remain read-only, but Sentinel may attach these staff-safe buttons where useful:

- `Refresh Roadmap` — owner/admin or rate-limited staff refresh from authoritative state.
- `Current Phase` — ephemeral summary of the active work and acceptance blockers.
- `Recent Completions` — ephemeral summary of recently completed roadmap items.

Buttons must not allow staff to arbitrarily set roadmap states. State changes come from canonical project status/acceptance evidence.

## Acceptance criteria

- `#nexus-roadmap` exists under Staff Hub.
- Sentinel publishes one persistent roadmap message and stores its channel/message IDs for future edits.
- Complete items render green, in-progress items orange, and not-started items red.
- State changes edit/move the existing roadmap entries rather than creating duplicate roadmap messages.
- Mobile presentation is readable without horizontal scrolling or oversized text blocks.
- Roadmap status cannot become green without the required completion/acceptance evidence.
- Private-edition-only functionality is never exposed in this staff-facing roadmap surface.
