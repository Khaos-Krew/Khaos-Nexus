# Khaos Nexus Web/PWA Sidecar Track

Status: **Incubation / side project**

This track exists to develop a lightweight web-first Khaos Nexus control surface in parallel with Discord/Sentinel implementation, without expanding or destabilizing the active Windows desktop stabilization scope.

## Guardrails

- Do not modify `stabilize/nexus-66-baseline` from this track.
- Do not make the Web/PWA a prerequisite for Discord/Sentinel acceptance.
- Do not duplicate backend business logic in the client.
- Treat the web client as a consumer of stable Nexus APIs/contracts.
- Keep privileged credentials and service secrets server-side.
- Use backend authorization for all privileged actions; hiding UI controls is not authorization.
- Private owner-only capabilities are not documented in this public repository beyond generic access-control contracts.

## Target architecture

```text
Discord users ---> Nexus Sentinel -----\
                                      \
Web/PWA users ---> Nexus Web/PWA ------> Nexus API / service layer ---> Nexus services
                                      /
Future desktop ---> lightweight client /
```

The long-term goal is to make the backend the source of truth while Discord, Web/PWA, and a future desktop client become replaceable interfaces.

## Client roles

### Discord + Sentinel
Primary community-facing interface for normal members and game-module interactions.

### Nexus Web/PWA
Primary browser-based administration and mobile-friendly Nexus interface. Designed to work on desktop, tablet, and phone, with installable PWA support.

### Future Nexus Desktop
A later lightweight owner/admin client focused on local diagnostics, secure local integrations, native notifications, updater/launcher behavior, and other Windows-specific capabilities.

## Phase 0 — Foundation

- [ ] Define web application package/repository boundary.
- [ ] Define Nexus API contract boundary.
- [ ] Define authentication and authorization model.
- [ ] Define role/capability mapping from Nexus accounts and Discord identity.
- [ ] Define environment separation for local, preview, and production.
- [ ] Define public vs private capability documentation rules.

## Phase 1 — Web/PWA shell

- [ ] Responsive application shell.
- [ ] Khaos Nexus navigation and visual system.
- [ ] Dashboard placeholder with service-health cards.
- [ ] Account/profile screen.
- [ ] PWA manifest and installability.
- [ ] Mobile navigation.
- [ ] Offline-safe application shell only; no privileged actions while offline.

## Phase 2 — Authentication and access control

- [ ] Discord/Nexus sign-in flow.
- [ ] Session handling.
- [ ] Backend-enforced role and capability checks.
- [ ] Owner/admin/moderator/member permission tiers.
- [ ] Explicit private-capability gate for owner-only functionality.
- [ ] Audit trail for privileged web actions.

## Phase 3 — Read-only Nexus dashboard

- [ ] Sentinel status.
- [ ] Backend/API health.
- [ ] Game-server status summaries.
- [ ] Module status summaries.
- [ ] Alerts and recent operational events.

This phase should remain read-only until the API contracts are stable.

## Phase 4 — Administrative controls

Migrate one bounded workflow at a time, validating backend authorization and audit behavior before enabling writes.

Candidate order:

1. Sentinel/module configuration.
2. Game-server administration.
3. Events and community operations.
4. Roles/ranks/levels management.
5. Suggestions/content-creator workflows.
6. Moderation/reporting surfaces.
7. Shop/content administration.

## Phase 5 — Private mobile capability

Add the private owner-only mobile surface behind server-side capability checks. Public repository code should contain only generic capability plumbing; private implementation details and content must remain outside public documentation and public release notes.

## Phase 6 — Desktop simplification

Once Web/PWA workflows are accepted, identify desktop functionality that can be retired or replaced by the web client. Keep only Windows-specific and owner-grade functions that materially benefit from native access.

## Initial technology direction

Preferred starting direction:

- Web/PWA frontend: React-based TypeScript application.
- Hosting target: Cloudflare Pages/Workers or equivalent low-cost edge/static platform.
- Auth/data: Nexus Account Service backed by Supabase where appropriate.
- API boundary: versioned Nexus service/API contracts.
- Repository source of truth: GitHub.

Technology choices remain provisional until Phase 0 is complete.

## Definition of first useful milestone

The first milestone is complete when an authenticated owner can install/open the Nexus PWA on a phone or desktop and see a responsive, read-only Nexus dashboard driven by a safe development/stub API contract, without any dependency on the active desktop stabilization build or Discord production deployment.
