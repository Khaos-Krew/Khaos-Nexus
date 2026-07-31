# Khaos Nexus Retired Product Surfaces

This document records product surfaces and repositories that are no longer active implementation sources for Khaos Nexus.

## Legacy Lovable website

**Status:** Retired and deleted  
**Canonical:** No  
**Retirement decision:** ADR-007 / GitHub issue #95

The former Lovable-hosted Khaos Nexus website is no longer an active product surface, administration surface, deployment target, or source of application architecture.

Future work must not:

- restore a website-centered control plane;
- treat deleted Lovable pages, routes, or configuration as current product requirements;
- assign implementation work to a legacy website production owner;
- infer that a live external service means the website remains active.

Any future public site must be approved as a supporting surface for the desktop-first application and implemented from a new, explicit handoff.

## Archived website repository

**Repository:** `Khaos-Krew/chaos-nexus-hub`  
**Status:** Archived and private  
**Canonical:** No  
**Allowed use:** Historical evidence and migration research only

The archived repository must not be used as:

- the Khaos Nexus application baseline;
- an active development branch source;
- a production deployment source;
- authority for current architecture, schemas, workflows, or release state.

It is preserved as historical evidence unless a separate explicit deletion decision is recorded.

## Canonical repositories

| Purpose | Repository | Status |
| --- | --- | --- |
| Khaos Nexus application | `Khaos-Krew/Khaos-Nexus` | Active and canonical |
| External diagnostics runtime | `Khaos-Krew/Khaos-Nexus-Diagnostics` | Active supporting runtime; not the application repository |
| Retired website history | `Khaos-Krew/chaos-nexus-hub` | Archived, private, non-canonical |

`Khaos-Krew/Khaos-Nexus` remains the sole canonical application repository. The exact application-code baseline must still be resolved from the approved branch, pull request, and commit for each handoff; `main` is not automatically the runtime baseline.

## Associated Supabase project hold

The Supabase project formerly associated with the website remains active while the Owner retention decision on issue #95 is pending.

Until that decision is recorded:

- read-only inspection is allowed;
- existing approved, non-destructive application use may continue;
- the project must not be paused;
- it must not be exported as a retirement action;
- it must not be deleted;
- credentials, user records, and private database contents must not be exposed.

A future desktop use of the Supabase project must be documented as an explicit shared-service dependency. It does not restore the retired website architecture or make the archived website repository canonical.

After the Owner records a decision on issue #95, Input and Routing must create one targeted Supabase handoff for the selected action. No Supabase retirement action is authorized by ADR-007 alone.

## Evidence recorded on July 31, 2026

- The Owner reported the Lovable project deleted.
- GitHub repository metadata confirmed `Khaos-Krew/chaos-nexus-hub` is archived and private.
- GitHub repository metadata confirmed `Khaos-Krew/Khaos-Nexus` is active and not archived.
- Searches of the canonical application repository found no direct `chaos-nexus-hub`, Lovable, or legacy website implementation reference.
- Read-only Supabase inspection confirmed the associated project remains active and healthy.
- Read-only Supabase inspection found no deployed Edge Functions.
