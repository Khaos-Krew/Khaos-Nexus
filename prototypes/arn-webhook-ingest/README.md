# ARN Webhook Ingest Prototype

Test-only Nexus Sentinel prototype for turning Shiny! Dinos Discord webhook events into classified ARN alerts.

## Flow

`Shiny! Dinos -> private #arn-ingest webhook channel -> Sentinel prototype -> parser -> classifier -> public ARN embed`

The prototype does not modify Shiny, scan ARK entities, or require ArkAPI.

## Features

- accepts webhook-authored messages only from a configured private ingest channel;
- optional source webhook-ID allow-listing;
- parses detected, signal-lost, contained, and terminated lifecycle events;
- handles Genesis 1 and Astraeos even when they share the same Discord webhook by preferring map/footer data over webhook identity;
- classifies anomalies into ARN Class I-IV;
- treats Enraged as Class IV / HIGH THREAT and advertises the Khaos Nexus 1 Tekgram termination reward;
- produces compact ARN Discord embeds;
- supports `ARN_DRY_RUN=true` so parsing can be verified without posting publicly;
- includes parser and classifier tests.

## Run

```bash
cd prototypes/arn-webhook-ingest
npm install
node --test
npm start
```

Copy `.env.example` into your runtime environment. Keep all Discord bot tokens and webhook URLs in Railway/environment variables; never commit them.

See `TESTING.md` for the staged Discord test and rollback procedure.
