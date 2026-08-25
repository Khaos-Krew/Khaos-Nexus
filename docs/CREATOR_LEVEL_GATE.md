# Content Creator Program — Community Level Gate

## Decision

Creator Program applications are gated by the existing Khaos Nexus Community XP/Level system so new Discord members must establish community participation before applying.

## Default

- Default minimum application level: **10**.
- The threshold must be configurable without a code change (environment/config driven).
- This gate applies to new applications only; it does not revoke or downgrade already-approved creators.

## Eligibility behavior

When a member selects **Apply for Creator Program**, Nexus Sentinal must query the authoritative Nexus Community XP profile for that immutable Discord user ID before opening the application modal.

Eligible:
- current community level >= configured creator minimum level.

Ineligible:
- do not open the application modal;
- reply ephemerally with current level, required level, and a friendly instruction to keep participating in the community;
- do not create an application or staff review card.

Verification unavailable:
- fail closed;
- do not allow the application to bypass the level requirement if the backend/community-level service is unavailable;
- tell the member eligibility could not be verified and to try again later.

## Integrity requirements

- Use the existing backend Community XP profile as the source of truth; do not infer eligibility from Discord roles or nickname/display name.
- Use immutable Discord user IDs.
- Staff/admin role possession does not silently bypass the public application gate unless a separate explicit owner policy is added later.
- Existing pending applications are preserved; the gate controls creation of new applications.
- Existing approved Content Creator profiles/roles are preserved.
- A user whose XP is later reduced below the minimum does not automatically lose approved creator status; revocation remains a staff moderation action.
- Application acceptance remains a staff decision even after the level gate is met.

## Discord UX

The managed Creator Program panel should state the current minimum level clearly, for example:

> **Community requirement:** Reach Nexus Community Level 10 before applying.

The application button remains visible so ineligible users can receive a clear private eligibility explanation rather than wondering why the feature is missing.

## Acceptance tests

- level below threshold is denied before modal creation;
- exact threshold is accepted;
- level above threshold is accepted;
- backend failure fails closed;
- denial response exposes no private backend details;
- no application record/review card is created for denied attempts;
- existing approved creators remain unchanged;
- configured threshold overrides the default;
- eligibility uses Discord user ID and cannot be bypassed by username/nickname changes.
