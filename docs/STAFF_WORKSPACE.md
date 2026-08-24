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
├─ #staff-offices
└─ 🔊 Staff Meeting Room
```

Existing unrelated Staff channels are **not deleted** during the 66% migration phase.

### `#staff-hub`

One pinned Sentinal-managed workspace panel points staff toward the correct operational surfaces and reminds staff to keep credentials and safety-report evidence out of routine staff discussion.

### `#staff-ops`

Shared day-to-day coordination, moderation handoffs, server/module operations, and implementation handoffs.

### `#admin-commands`

One pinned duplicate-safe reference generated from the current Nexus command/capability contracts.

The reference includes:

- `/clear`;
- hosted Admin Control Center pairing;
- Nexus setup/repair controls;
- community XP administration;
- backend module capabilities that explicitly require Nexus Operator or Owner authority.

Privileged module actions are represented by the guaranteed compatibility form:

```text
/nexus run module:<module> action:<capability>
```

This avoids documenting guessed aliases. Runtime permission, confirmation, and audit checks remain authoritative even when a command appears in the reference.

The reference has a denylist guard so restricted private-only functionality cannot be rendered into the staff command panel.

### `#staff-offices`

Individual staff offices become **private Discord threads**, not top-level channels.

Thread naming:

```text
Office • <display name> • <last six digits of Discord user ID>
```

The stable user-ID suffix lets Sentinal reuse the correct office after a display-name change.

Normal staff receive thread participation permission but not `Manage Threads`. Owners and Sentinal retain thread-management authority for recovery. A normal staff member is explicitly added only to their own managed office thread.

Sentinal can reopen an archived office and re-add its assigned staff member during reconciliation.

### Staff Meeting Room

One shared staff voice room replaces unnecessary per-person voice-office clutter. Additional incident/case privacy should use the dedicated restricted report system rather than permanent extra staff voice channels.

## Privacy and authority

The Staff category denies `View Channel` to `@everyone`.

Access is granted to:

- configured safety/staff roles;
- configured Nexus operator roles;
- configured owner user IDs;
- Nexus Sentinal itself.

When explicit staff/operator role IDs are unavailable, Sentinal falls back to editable guild roles carrying Administrator, Moderate Members, or Manage Server authority.

The separate private-report category/archive remains authoritative for safety cases. The Staff workspace does not absorb report tickets or their evidence.

## Reconciliation

At startup and every 15 minutes Sentinal:

1. adopts/creates the Staff category;
2. reapplies the protected Staff-category permission contract;
3. creates/adopts/moves the managed channels;
4. reuses one canonical `#staff-hub` panel;
5. reuses one canonical `#admin-commands` panel;
6. removes duplicate Sentinal-owned versions of those panels;
7. discovers current staff members;
8. creates/reopens their private office threads as needed.

Legacy Staff channels remain untouched until final migration acceptance.

## 66% acceptance boundary

The section reaches 66% when:

1. protected Staff-category reconciliation is implemented;
2. the compact managed channel layout is implemented;
3. private office-thread creation/recovery is implemented;
4. the capability-driven privileged command reference is implemented;
5. restricted-content filtering is covered by tests;
6. CI and Windows packaging/update smoke tests pass;
7. hosted Sentinal reconciles the workspace successfully;
8. the required public-safe 66% patch note posts once.

## 100% acceptance boundary

Do **not** publish Staff Workspace 100% until live staff testing verifies:

1. authorized staff can see and use the Staff workspace;
2. a normal non-staff account cannot see it;
3. normal staff can use their own private office thread;
4. normal staff cannot browse another staff member's private office;
5. owners/Sentinal retain intended recovery access;
6. the `#admin-commands` reference matches the live privileged command/capability set;
7. the Staff hub/admin panels remain single and pinned across restart;
8. no safety-report channels/evidence were moved or exposed;
9. obsolete per-staff office channels can be identified and archived/removed only after human confirmation that their content has been preserved or is no longer needed;
10. final reconciliation produces no permission or duplication warnings.

Only after those checks should legacy Staff-office clutter be removed and the 100% milestone queued.
