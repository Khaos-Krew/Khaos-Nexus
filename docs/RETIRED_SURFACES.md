# Khaos Nexus Retired Product Surfaces

This document records product surfaces and repositories that are no longer active implementation sources for Khaos Nexus.

## Legacy Lovable website

**Status:** Retired and deleted  
**Canonical:** No  
**Retirement decision:** ADR-007 / GitHub issue #95

The former Lovable-hosted Khaos Nexus website is no longer an active product surface, administration surface, deployment target, or source of application architecture. The Lovable implementation used Lovable-managed cloud services. It did not use Khaos Nexus Supabase project `gcdgcftsjorsubutsamh`.

Future work must not:

- restore a website-centered control plane;
- treat deleted Lovable pages, routes, configuration, or managed cloud resources as current product requirements;
- assign implementation work to a legacy website production owner;
- infer that an independent Khaos Nexus shared service means the website remains active.

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
- authority for current architecture, schemas, workflows, services, or release state.

It is preserved as historical evidence unless a separate explicit deletion decision is recorded.

## Canonical repositories

| Purpose | Repository | Status |
| --- | --- | --- |
| Khaos Nexus application | `Khaos-Krew/Khaos-Nexus` | Active and canonical |
| External diagnostics runtime | `Khaos-Krew/Khaos-Nexus-Diagnostics` | Active supporting runtime; not the application repository |
| Retired website history | `Khaos-Krew/chaos-nexus-hub` | Archived, private, non-canonical |

`Khaos-Krew/Khaos-Nexus` remains the sole canonical application repository. The exact application-code baseline must still be resolved from the approved branch, pull request, and commit for each handoff; `main` is not automatically the runtime baseline.

## Independent active Supabase shared service

Supabase project `gcdgcftsjorsubutsamh` is an independent active Khaos Nexus shared-service project. It was never part of the deleted Lovable website, and ADR-007 does not retire, hold, pause, export, or delete it.

Approved production work may inspect and use the project when an assigned handoff explicitly includes Supabase schema, RLS, authentication, storage, Edge Functions, or application integration. Current examples include D&D handoff #94.

All work must:

- inspect the existing schema, policies, functions, storage, and integrations before changes;
- preserve existing data and working application behavior;
- maintain RLS, credential protection, auditability, and compatibility boundaries;
- avoid citing `Khaos-Krew/chaos-nexus-hub` as the source of current schemas or implementation;
- require a separate explicit handoff and Owner approval for destructive lifecycle actions such as project deletion.

The presence or use of this shared service does not restore the retired website architecture.

## Evidence and correction recorded on July 31, 2026

- The Owner reported the Lovable project deleted and clarified that it used Lovable-managed cloud services.
- The Owner confirmed Supabase project `gcdgcftsjorsubutsamh` was never part of the Lovable website.
- GitHub repository metadata confirmed `Khaos-Krew/chaos-nexus-hub` is archived and private.
- GitHub repository metadata confirmed `Khaos-Krew/Khaos-Nexus` is active and not archived.
- Searches of the canonical application repository found no direct `chaos-nexus-hub`, Lovable, or legacy website implementation reference.
- Read-only Supabase inspection confirmed project `gcdgcftsjorsubutsamh` is active and healthy.
- Read-only Supabase inspection found no deployed Edge Functions at the time of inspection.
- Issue #94 records the Supabase project as a current desktop shared-service dependency.
