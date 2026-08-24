# Staff-Compatible Name Color Presentation

Status: **DESIGN / PREVIEW ONLY — NO LIVE ROLE MUTATION AUTHORIZED**

Issue: #350

## Owner decision already recorded

Staff should eventually be able to display the same selectable Nexus name colors as normal members, but Sentinal must not solve that by moving shared selectable color roles above protected moderation/admin roles.

## Discord constraint

Discord renders a member name using the color of the member's highest colored role. Therefore a colored staff/moderation role above the selectable Nexus color role will visually override the selected name color even when the selectable role itself is assigned correctly.

## Safe architecture

The safe migration model separates **authority** from **presentation**:

1. Staff permission/moderation roles keep their current hierarchy positions, permissions, IDs, and management boundaries.
2. Shared selectable Nexus color roles remain ordinary self-service presentation roles and never receive moderation permissions.
3. A staff role is eligible for presentation migration only when its current color is the sole reason it visually overrides the selected name color.
4. Eligible staff roles may be previewed as color-neutral while retaining their existing permissions, hierarchy position, name, ID, icon, and hoist state.
5. Staff identity should remain visible through the role name, role icon/badge where already available, member-list hoisting where already configured, and channel permission authority rather than relying on role text color.
6. Sentinal must never automatically neutralize a role merely because it has moderation permissions. Every proposed role must appear in an Owner preview first.
7. Roles that are managed/integration roles, bot roles, premium subscriber roles, or otherwise not safely editable must be reported as blocked and excluded from mutation.

## Preview contract

A read-only preview should report, for every protected staff/admin role above the selectable color roles:

- role ID and name;
- current hierarchy position;
- current color / hex;
- whether the role is managed;
- whether it is hoisted;
- permission summary relevant to moderation/admin authority;
- whether its current color can override selectable name colors;
- whether it is eligible for a future color-neutral presentation migration;
- explicit blockers/reasons when not eligible.

The preview must also report the highest selectable Nexus color-role position so the Owner can understand why a role is or is not overriding the selected color.

## Future apply contract

No apply path is authorized by this document. A later implementation may be added only after the Owner reviews the generated preview and explicitly approves the exact staff roles to migrate.

If approved later, the apply operation must:

- accept an exact allowlist of role IDs from the approved preview;
- re-read each live role and fail closed if its ID, hierarchy, managed state, or expected pre-change color no longer matches the preview;
- change presentation color only; never change permissions, position, membership, name, icon, hoist, mentionability, or role ownership;
- persist a rollback ledger containing the exact original color for every changed role;
- support an explicit rollback that restores only those colors and again fails closed on unexpected role drift;
- produce redacted audit evidence without exposing unrelated guild configuration.

## Acceptance target

After a future Owner-approved migration:

- staff authority and moderation hierarchy are unchanged;
- no selectable color role is moved above protected staff/moderation roles;
- staff who select a Nexus name color visibly use that color where Discord hierarchy permits;
- non-staff behavior is unchanged;
- rollback restores the previous staff role colors exactly.
