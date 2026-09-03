# ARN Webhook Ingest Prototype

Test-only Nexus Sentinel prototype for turning Shiny! Dinos Discord webhook events into classified ARN alerts.

## Flow

`Gen1 Shiny webhook -> private #arn-ingest -> Sentinel -> parser/classifier -> one public ARN result`

`Astraeos Shiny webhook -> private #arn-ingest -> Sentinel -> parser/classifier -> one public ARN result`

Each ARK map gets its own Discord webhook, but every webhook posts into the same private ingest channel. Sentinel uses the webhook ID as the authoritative map identity, then emits one normalized ARN embed to the shared public output channel.

The prototype does not modify Shiny, scan ARK entities, or require ArkAPI.

## Features

- requires dedicated Shiny webhook-to-map mappings;
- accepts webhook-authored messages only from the configured private ingest channel;
- ignores unregistered webhook IDs;
- uses each map's webhook ID as the authoritative server/map source;
- warns if Shiny payload/footer map text disagrees with the webhook mapping;
- parses detected, signal-lost, contained, and terminated lifecycle events;
- produces at most one ARN output message per accepted Shiny source message;
- classifies anomalies into ARN Class I-IV;
- treats Enraged as Class IV / HIGH THREAT and advertises the Khaos Nexus 1 Tekgram termination reward;
- produces compact ARN Discord embeds;
- supports `ARN_DRY_RUN=true` so parsing can be verified without posting publicly;
- supports a JSON webhook map for adding future cluster maps without changing code;
- includes parser and classifier tests.

## Run

```bash
cd prototypes/arn-webhook-ingest
npm install
node --test
npm start
```

Copy `.env.example` into your runtime environment. Keep Discord bot tokens and webhook URLs in Railway/environment variables; never commit them.

See `TESTING.md` for the staged Discord test and rollback procedure.
