# ArkShop MySQL bridge retired (2026-09-23)

The in-game ArkShop plugin is disabled on the cluster servers. Founder point balances were ADD-ported into Nexus Points wallets. The bot-side MySQL bridge is retired.

## Runtime switch

Set `ARKSHOP_DB_MODE=disabled`. The same off switch accepts `off`, `retired`, `none`, `false`, or `0`. `NEXUS_ARKSHOP_MYSQL_ENABLED=false` also retires the bridge.

While retired, Sentinal and Ascended do not open MySQL, do not poll ArkShop status, and do not log incomplete-variable errors. Dino-cache receipt polling, weekly-cache rotation, ARN token sync, and the cache delivery worker no-op.

Discord `/arkrcon` is unchanged. RCON settings stay in the Discord override store.

## Balances left behind

Three unknown EOS rows, with point balances 34, 30, and 10, were never ported. They are not in Nexus Points wallets.
