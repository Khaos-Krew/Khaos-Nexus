# Khaos Nexus production build workers

The production build cluster consists of three identical workers backed by one PostgreSQL queue:

| Service | Preferred lane | Intended work |
| --- | --- | --- |
| `KNX-BUILD-NODE-01` | `forge` | Forge builds and development validation |
| `KNX-BUILD-NODE-02` | `ark` | ARK server, config, and plugin work |
| `KNX-BUILD-NODE-03` | `general` | General and overflow work |

Lane preference does not permanently pin a job. All nodes advertise build, test, validation, and deployment capabilities, so idle capacity can take overflow work.

## Safety model

- A worker leases one job using a PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`.
- The lease is renewed by heartbeat and an expired lease returns to the queue.
- Jobs use structured, allowlisted commands; shell command strings are rejected.
- A Sentinal deployment is blocked unless the release target is `KNX-SENTINAL-CORE-PROD`, its artifact type is `SENTINAL_RUNTIME`, and build, test, validation, and approval have all passed.
- PostgreSQL advisory locking and `nexus_production_locks` ensure only one worker can promote Sentinal at a time.
- The deployment is not marked healthy until the replacement answers its health endpoint.
- ARK config, ArkShop, WBUI2, Forge, and general artifacts can never pass the Sentinal runtime deployment gate.

## Required worker variables

`DATABASE_URL`, `NODE_ID`, `NODE_LANE`, and `WORKER_API_TOKEN` are required for production. `GITHUB_TOKEN` is required for private repositories. `NODE_CAPABILITIES` defaults to `build,test,validation,deploy`.

`SENTINAL_DEPLOY_WEBHOOK_URL` and `SENTINAL_HEALTH_URL` intentionally remain unset during the initial rollout. This leaves deployment jobs blocked while allowing all three workers, their queue, leasing, and health endpoints to be validated without changing live Sentinal.

Sentinal and Forge can use the authenticated worker API to create releases (`POST /releases`), enqueue stages (`POST /jobs`), approve a fully passed release (`POST /releases/:id/approve`), and read shared cluster state (`GET /cluster`). All nodes expose the same API over the same PostgreSQL state.

## Railway isolation

Workers use `Dockerfile.build-worker` and watch only the worker runtime, its tests, and package manifests. Live Sentinal continues to watch `railway-release/**`, so worker changes do not redeploy it.
