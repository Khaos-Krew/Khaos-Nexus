# Khaos Nexus Content Creator Program

## Purpose

The Content Creator Program gives approved community creators a consistent Khaos Nexus home for collaboration, promotional resources, and livestream visibility without turning creator access into an automatic self-role.

## Discord structure

Sentinal manages a dedicated `CONTENT CREATOR PROGRAM` category with these core channels:

- `#creator-program` — program information and application intake.
- `#creator-assets` — approved-creator access to official reusable Nexus creator assets/templates.
- `#creator-chat` — approved-creator collaboration space.
- `#creator-review` — protected Staff review queue outside the public category.

Public posts use one read-only channel under `INFORMATION`:

- `#creator-feed` — members can view and read history. Only Nexus Sentinal can send. Sentinal finds this channel or creates it. The 60-second creator-workspace lockdown does not hide it, and it also leaves public creator channels (`#creator-feed`, `#twitch-live`, `#youtube-live`) exempt if they sit inside the creator category.

`#twitch-live` and `#youtube-live` are legacy channels. Sentinal no longer creates or rewrites them. `#creator-feed` replaces those feeds.

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
6. Approval assigns the `Content Creator` role and creates a creator profile, including saved Twitch, YouTube, and TikTok handles when the application includes them.
7. Denial requires a staff reason and preserves the decision in the application record.
8. A member with a pending or approved application cannot create duplicate active applications.

## Platform scope

Supported platforms on the application form:

- Twitch
- YouTube
- TikTok

TikTok is stored as `tiktok` with a saved handle. It is not recorded as `other`.

Approved creators can share a link with `/creator post url:` into `#creator-feed`. Optional `ping` mentions the existing Stream Alerts role through `allowed_mentions` and does not ping `@everyone`. Verification uses free, keyless endpoints only:

- TikTok: `https://www.tiktok.com/oembed`, and `author_unique_id` must match the saved handle.
- YouTube: oEmbed, and the author must match the saved channel.
- Twitch: a channel URL or clip whose login matches the saved handle. Clip links that omit the login are rejected.

Each creator can post 3 times per 24 hours. A URL already in the feed is rejected. Revoked creators are blocked. `CREATOR_POST_ENABLED` defaults to true and does nothing harmful when `#creator-feed` is missing.

There is no paid API, no scraper, no automatic live detection, and no manual Now Live toggle. The `Now Live` role stays provider-only:

- Twitch automatic live detection requires authorized Twitch application credentials.
- YouTube automatic live detection requires an authorized YouTube Data API credential.
- Until those adapters are configured and accepted, `Now Live` is not assigned by creator posts.

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
