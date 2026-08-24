# Khaos Nexus Community XP & Leveling

Status: **66% IMPLEMENTATION MILESTONE — LIVE ACCEPTANCE REQUIRED BEFORE 100%**

This system rewards participation in the Khaos Nexus community. It is deliberately separate from monetized/supporter entitlements and operational permissions.

## Authority separation

Community XP and milestone roles **must never grant, replace, reorder, or infer**:

- Nexus Shop/supporter ranks;
- game/module access roles;
- staff/admin/moderation roles;
- Name Color roles;
- account ownership or privileged Nexus permissions.

Managed milestone badges use the exact prefix `Community Level • ` so they remain identifiable as community-progression roles.

## Level curve

Cumulative XP required for level `L`:

```text
XP(L) = 100 × (L - 1)²
```

Examples:

| Level | Total XP |
| ---: | ---: |
| 1 | 0 |
| 2 | 100 |
| 5 | 1,600 |
| 10 | 8,100 |
| 20 | 36,100 |
| 30 | 84,100 |
| 50 | 240,100 |
| 75 | 547,600 |
| 100 | 980,100 |

The curve is intentionally nonlinear: early levels arrive quickly enough to feel responsive, while high levels represent sustained community participation.

## Default XP sources

### Messages

- 15 XP per eligible award.
- 90-second per-member cooldown.
- 300 XP/day message cap before the next UTC day reset.
- bots and webhooks never earn XP.
- ignored channels and ignored roles are excluded.
- when the Discord Message Content intent is deliberately enabled, Sentinal also requires at least 12 normalized characters and three meaningful words, rejects command-like messages, and suppresses repeated normalized messages for ten minutes.
- without privileged Message Content access, Sentinal operates in privacy-safe metadata mode. The cooldown and daily cap remain enforced, so rapid tiny-message spam cannot accelerate beyond the bounded source cap.
- raw message text is never persisted in the XP database or audit log.

### Voice

- 10 XP per eligible ten-minute interval.
- 300 XP/day voice cap.
- a voice channel must contain at least two eligible human members.
- bots do not count toward the two-member minimum.
- the guild AFK channel is excluded.
- self-deafened and server-deafened members are excluded from accrual.
- ignored channels/roles are excluded.
- leaving an eligible voice state clears the current interval timer; rejoining requires a fresh interval.

### Events

Event integrations may award XP through the authenticated Nexus Backend service contract. Default event cap: 1,000 XP/day. Event hooks are integration-driven; the source toggle does not invent attendance.

### Module participation

Game-module integrations may award bounded XP through the same authenticated service contract. Default module cap: 300 XP/day. Normal game/module access still comes only from module-access authority, never from XP.

## Multiplier

Automatic-source XP can use a global multiplier from `0.0×` through `5.0×`. Daily source caps are applied after the multiplier, preventing boosted events from bypassing the configured daily ceiling.

Admin XP adjustments are explicit and are not multiplied.

## Milestone roles

Default milestone levels:

- 5
- 10
- 20
- 30
- 50
- 75
- 100

Sentinal lazily creates only the milestone role a member actually qualifies for, using names such as `Community Level • 10`. If an administrator lowers or resets XP, managed milestone roles above the member's resulting level are removed during role synchronization.

Milestone roles are badges only. They carry no Shop entitlement or access authority.

## User commands

- `/level [user]` — level, total XP, leaderboard rank, and progress to the next level.
- `/rank [user]` — the same community progression profile with leaderboard placement.
- `/leaderboard` — top ten community XP profiles.

## Staff/admin commands

`/xp` requires Manage Server permission or configured Nexus owner authority.

- `/xp add`
- `/xp remove`
- `/xp set`
- `/xp reset`
- `/xp multiplier`
- `/xp source`
- `/xp ignore-channel`
- `/xp ignore-role`
- `/xp status`

Admin changes and explicit event/module awards are audit-safe. Audit entries contain IDs, source, amount, reason, and timestamp—not message content.

## Discord presentation

Sentinal owns one canonical persistent panel in `INFORMATION → #level-up`.

The panel explains:

- XP sources and caps;
- anti-farming behavior;
- commands;
- current multiplier/source state;
- milestone levels;
- the separation between community levels and Shop/access/staff/color authority.

When a member levels up, Sentinal posts a scoped announcement in `#level-up` and only mentions the member who leveled.

## Persistence

Backend state defaults to:

```text
data/community-leveling.json
```

On Railway this remains under the existing persistent `/app/data` volume path. Writes use the existing atomic temporary-file + rename pattern and file mode protections from `JsonStore`.

## 66% acceptance boundary

The section reaches 66% when:

1. backend persistence/curve/caps/settings/admin operations are implemented and green in CI;
2. Discord commands and persistent `#level-up` presentation are implemented;
3. message and voice source guards are implemented;
4. milestone roles remain authority-separated;
5. the public-safe 66% patch note publishes after deployment.

## 100% acceptance boundary

Do **not** publish the 100% milestone until live tests verify:

1. a normal member earns message XP at the expected cooldown/cap;
2. voice XP requires a qualifying human voice group and respects leave/AFK/deaf behavior;
3. `/level`, `/rank`, and `/leaderboard` reflect persisted backend state;
4. `/xp` permissions and add/remove/set/reset work from an authorized staff account;
5. a real level-up announcement appears once in `#level-up`;
6. at least one milestone badge is created/assigned correctly or is safely simulated against a controlled test member;
7. Shop/supporter, module access, staff, and Name Color roles remain untouched;
8. state survives a hosted restart;
9. no duplicate panel/announcement behavior or unbounded listener warning appears.

Seasonal leaderboards and additional event/module award integrations remain later expansion work and are not required for the first 100% community-level acceptance.
