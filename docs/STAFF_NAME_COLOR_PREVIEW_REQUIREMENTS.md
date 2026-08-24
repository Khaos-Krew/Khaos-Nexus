# Staff Name Color Preview Requirements

This companion note defines the non-mutating implementation boundary for issue #350.

The first production slice must be read-only. It may inspect the live guild role hierarchy and calculate which protected staff/admin roles visually override selectable Nexus name-color roles, but it must not edit any role.

Required output:

- highest selectable Nexus color-role position;
- protected staff/admin roles above that position;
- role ID, name, position, current hex color, managed state, hoist state, and relevant moderation/admin permission flags;
- `overridesSelectableColor` boolean;
- `eligibleForColorNeutralPreview` boolean;
- blockers explaining managed/integration or other unsafe roles;
- an exact proposed role-ID allowlist for later Owner review.

The later mutation path remains intentionally blocked until the Owner explicitly approves the exact previewed role IDs.
