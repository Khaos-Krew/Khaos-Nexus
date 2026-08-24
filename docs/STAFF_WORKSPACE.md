# Khaos Nexus Staff Workspace

Status: **66% IMPLEMENTATION MILESTONE — STAFF ACCEPTANCE REQUIRED BEFORE 100%**

The Staff workspace consolidates routine staff coordination without weakening the privacy boundary around safety reports or creating one permanent sidebar channel for every staff member.

## Managed layout

Sentinal adopts the existing Staff category when present. If none exists it creates:

```text
🔒 STAFF
├─ #staff-hub
├─ #staff-ops
├─ #admin-commands
├─ #roadmap
├─ 🗂 staff-offices (Forum)
└─ 🔊 Staff Meeting Room
```

Existing unrelated Staff channels are **not deleted** during the 66% migration phase.

### `#staff-hub`

One pinned Sentinal-managed workspace panel points staff toward the correct operational surfaces and reminds staff to keep credentials and safety-report evidence out of routine staff discussion.

### `#staff-ops`

Shared day-to-day coordination, moderation handoffs, server/module operations, and implementation handoffs.

### `#admin-commands`

One pinned duplicate-safe reference generated from the current Nexus command/capability contracts.

The reference includes `/clear`, hosted Admin Control Center pairing, Nexus setup/repair controls, community XP administration, and backend module capabilities that explicitly require Nexus Operator or Owner authority.

Privileged module actions are represented by the guaranteed compatibility form:

```text
/nexus run module:<module> action:<capability>
```

This avoids documenting guessed aliases. Runtime permission, confirmation, and audit checks remain authoritative even when a command appears in the reference.

The reference has a denylist guard so restricted private-only functionality cannot be rendered into the staff command panel.

### `#roadmap`

One pinned, duplicate-safe Sentinal roadmap panel summarizes:

- live/accepted milestones;
- active 66% acceptance sections;
- remaining Discord + Nexus Setup Acceptance gates;
- the next planned production continuation;
- the 66%/100% patch-note rule.

This is a staff-facing operational snapshot. Repository roadmap/status documents remain the canonical engineering source of truth.

### `staff-offices` forum

The canonical staff-office surface is a real Discord **Forum channel**. Sentinal creates one managed forum post per current staff member with a stable title:

```text
Office • <display name> • <last six digits of Discord user ID>
```

The stable user-ID suffix lets Sentinal reuse the correct office after a display-name change.

Forum tags are provided for `Office`, `Handoff`, and `Planning`.

**Discord forum posts inherit the Forum channel's visibility.** Because the whole Forum is inside the protected Staff category, office posts are staff-only versus the wider community, but they are not individually hidden from other authorized staff members. Sensitive safety-report evidence must remain in the dedicated restricted report system.

If the previous 66% implementation already created a text `#staff-offices`, Sentinal does not delete it. The channel is renamed to a deterministic `staff-offices-legacy-####` name so existing private-thread history remains preserved, then the real Forum channel takes the canonical `staff-offices` name.

### Staff Meeting Room

One shared staff voice room replaces unnecessary per-person voice-office clutter. Additional incident/case privacy should use the dedicated restricted report system rather than permanent extra staff voice channels.

## Privacy and authority

The Staff category denies `View Channel` to `@everyone`.

Access is granted to configured safety/staff roles, configured Nexus operator roles, configured owner user IDs, and Nexus Sentinal itself.

When explicit staff/operator role IDs are unavailable, Sentinal falls back to editable guild roles carrying Administrator, Moderate Members, or Manage Server authority.

The separate private-report category/archive remains authoritative for safety cases. The Staff workspace does not absorb report tickets or their evidence.

## Reconciliation

At startup and every 15 minutes Sentinal:

1. adopts/creates the Staff category;
2. reapplies the protected Staff-category permission contract;
3. creates/adopts/moves `#staff-hub`, `#staff-ops`, `#admin-commands`, and `#roadmap`;
4. migrates an incorrectly typed `#staff-offices` text channel to a preserved legacy name when necessary;
5. creates/adopts the canonical `staff-offices` Forum;
6. reuses one canonical `#staff-hub` panel;
7. reuses one canonical `#admin-commands` panel;
8. reuses one canonical `#roadmap` panel;
9. removes duplicate Sentinal-owned versions of those panels;
10. discovers current staff members;
11. creates/reopens their office forum posts as needed.

Legacy Staff channels remain preserved until final migration acceptance.

## 66% acceptance boundary

The section remains at 66% while the corrected Forum/roadmap layout is deployed and verified live.

## 100% acceptance boundary

Do **not** publish Staff Workspace 100% until live staff testing verifies:

1. authorized staff can see and use the Staff workspace;
2. a normal non-staff account cannot see it;
3. `staff-offices` is visibly a Discord Forum, not a normal text channel;
4. each current staff member has one reusable office forum post;
5. the `#roadmap` panel exists, is pinned, and remains single across restart;
6. the `#admin-commands` reference matches the live privileged command/capability set;
7. the Staff hub/admin/roadmap panels remain single and pinned across restart;
8. no safety-report channels/evidence were moved or exposed;
9. the old text-based office surface remains preserved until its history is explicitly approved for retirement;
10. final reconciliation produces no permission or duplication warnings.

Only after those checks should obsolete Staff-office clutter be removed and the 100% milestone queued.
