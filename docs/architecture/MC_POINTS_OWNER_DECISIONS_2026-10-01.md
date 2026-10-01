# Minecraft Points owner decisions

## OWNER DECISIONS

- A verified `/mc link` qualifies an identity for Minecraft-earned Nexus Points. EOS is not required. Status: pending WARDEN sign-off.
- No Minecraft Points are credited unless the economic identity is verified and the Minecraft link is verified.
- Partial delivery: lines already delivered stand, and the remainder goes to SENT_UNCONFIRMED for staff. Those lines are not auto-retried and not auto-refunded.

## Flags

Enable flags stay off unless set: `MC_POINTS_ENABLED`, `MC_PLAYTIME_NP_ENABLED`, `MC_SHOP_ENABLED`, `MC_SHOP_DELIVERY_ENABLED`, `MC_STARTER_KIT_ENABLED`. `MC_SHOP_ENABLED` is the narrow shop flag. `MC_PLAYTIME_DRY_RUN` defaults on. Dry-run logs the credit and cap math and writes nothing. Poller timestamps are ignored. Existing economy write flags are unchanged.

## Craft token

`NEXUS_ECONOMY_CRAFT_TOKEN` is limited to presence, link and unlink, delivery claim and delivery status, the refund sweep, and the pending-order and kit-grant reads. Buy, quote, and staff refunds use Sentinal's token only. Credit, spend, identity, and admin routes reject the craft token.
