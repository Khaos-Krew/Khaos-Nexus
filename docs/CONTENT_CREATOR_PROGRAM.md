# Khaos Nexus Content Creator Program

## Purpose

The Content Creator Program gives approved community creators a consistent Khaos Nexus home for collaboration, promotional resources, and livestream visibility without turning creator access into an automatic self-role.

## Discord structure

Sentinal manages a dedicated `CONTENT CREATOR PROGRAM` category with these core channels:

- `#creator-program` — public read-only program information and application intake.
- `#creator-assets` — approved-creator access to official reusable Nexus creator assets/templates.
- `#creator-chat` — approved-creator collaboration space.
- `#twitch-live` — public read-only Twitch live-notification feed.
- `#youtube-live` — public read-only YouTube live-notification feed.
- `#creator-review` — protected Staff review queue outside the public category.

## Roles

### Content Creator

- Granted only after an application is approved.
- Used for creator-only channel permissions.
- Intentionally has no name color so community Name Color roles remain authoritative.

### Now Live

- Temporary livestream-state role.
- Intentionally has no name color so it never steals visual priority from a selected Name Color role.
- Hoisted so active creators can be visually grouped while live.
- Must only be toggled by an authorized Twitch/YouTube provider adapter; it is not a self-role.

## Application workflow

1. Member selects **Apply for Creator Program** in `#creator-program`.
2. Sentinal collects platform(s), channel URL/handle, content focus, and reason for joining.
3. Application receives a durable `CCR-####` identifier and is stored in Sentinal state.
4. Sentinal posts the application into protected `#creator-review`.
5. Authorized Staff/Owners approve or deny.
6. Approval assigns the `Content Creator` role and creates a creator profile for future provider linking.
7. Denial requires a staff reason and preserves the decision in the application record.
8. A member with a pending or approved application cannot create duplicate active applications.

## Platform scope

Initial supported targets:

- Twitch
- YouTube

TikTok is deferred until the first two live-detection adapters are stable.

The Discord program core does not pretend external automation is ready merely because channels exist. Provider readiness is explicit:

- Twitch automatic live detection requires authorized Twitch application credentials.
- YouTube automatic live detection requires an authorized YouTube Data API credential.
- Until those adapters are configured and accepted, the `Now Live` role and live-feed channels remain provider-ready infrastructure rather than manually/falsely updated status.

## Creator assets

`#creator-assets` is the canonical Discord home for official creator-facing Khaos Nexus graphics. Asset rules:

- Preserve the approved Khaos Nexus base identity.
- Use reusable templates that allow the creator name to be added without rebuilding the Nexus identity.
- Sentinal maintains the resource surface as formats are added.
- The visual asset pack is delivered separately from this Discord/backend core so the approved source artwork can be used directly.

## Milestones

The core application/category/roles/review/resource surfaces qualify for the 66% milestone after live Discord verification.

100% requires:

- Twitch provider integration accepted live.
- YouTube provider integration accepted live.
- `Now Live` role automatically assigned/removed from verified platform state.
- Platform-specific live notifications published without duplicates.
- Creator asset pack delivered into `#creator-assets` from the approved Nexus base artwork.
- End-to-end creator application and live-state acceptance completed.
