# Workflow engines

A workflow run can last hours. A durable execution engine remembers which steps of a run are done,
so a crashed or redeployed process continues the run and does not start it again. A deployment
picks one engine with `WORKFLOW_ENGINE`. An organization can instead connect its own Inngest or
Temporal account.

Nothing here is required. A deployment that sets none of these variables behaves as it did before
the engines existed: Temporal when `TEMPORAL_ADDRESS` is set, and Postgres otherwise.

## Overview

One graph interpreter, `runGraph` in `apps/agent-worker/src/engines/runGraph/`, runs every
workflow. It walks the graph in topological order and does all side effects through a small
`DurableContext` (`call` an activity, `sleep`). The four engines differ only in how they implement
that interface and how they start and cancel a run:

| Engine | Who remembers finished steps | Who runs the node work |
| --- | --- | --- |
| `temporal` | Temporal | the agent worker |
| `postgres` | the `workflow_run_checkpoints` table, through the API | the agent worker |
| `inngest` | Inngest | the agent worker (dials out with Inngest Connect) |
| `trigger` | the `workflow_run_checkpoints` table, through the API | Trigger.dev's machines |

How the engine is chosen, in order:

1. The organization's own connection, if it has one (see "Organization connections").
2. `WORKFLOW_ENGINE`, one of `temporal`, `postgres`, `inngest`, `trigger`.
3. `temporal` when `TEMPORAL_ADDRESS` is set, `postgres` otherwise.

Every run row stores the engine that started it (`workflow_runs.engine`) and, for an organization
connection, `engine_connection_id`. Cancel goes to that engine and that account, so it stays
correct after you change the setting. After the engine stops a run, the API finishes the cancel
itself (`finalizeCanceledRun`): it marks the run and its steps `canceled` and kills CLI jobs on
the host. No engine has to run cleanup code.

Every engine delivers a step result at least once. The one step that must not run twice, starting
an agent, is protected on the API side: `dispatchAgent` returns the existing handle when the step
already has one.

If the selected engine is not configured, the dispatch is rejected and the run is stored as
`failed` with a message that names the engine and the variable, for example
`Workflow engine inngest is not configured: INNGEST_EVENT_KEY is not set.` The worker uses the same
wording at start-up.

All variables below are optional. They go in the five places in `docs/environment-variables.md`.
`WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS` and `WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS` are explained
under "Organization connections".

## Temporal

The default when `TEMPORAL_ADDRESS` is set.

- API: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` (default `default`), `TEMPORAL_API_KEY` for
  Temporal Cloud. `WORKFLOW_ENGINE=temporal` is optional.
- Worker: the same three variables, plus `AGENT_API_URL` and `AGENT_WORKER_SECRET`. The worker
  listens on the task queue `agent`. It registers the `workflowRun` workflow and, for Devs, the
  `agentSession` workflow.
- Poll chunk: an agent or CLI node is polled in 15-minute pieces. Failed poll calls retry with
  backoff from 5 seconds up to 5 minutes.
- Local: `cd apps/agent-worker && bun run temporal:dev` (a dev server on port 7233, UI on 8233),
  then `bun run start` with `AGENT_API_URL` and `AGENT_WORKER_SECRET` set.
- You give up nothing. This is the only engine that also runs Devs (`agentSession`), so a deployment
  that wants Devs keeps `TEMPORAL_ADDRESS` set whatever `WORKFLOW_ENGINE` says. The worker then
  starts its Temporal worker next to the engine you chose.

## Postgres

The default when `TEMPORAL_ADDRESS` is not set. It needs only the database the app already has.

- API: `WORKFLOW_ENGINE=postgres`, or nothing. A `pending` row with `engine = 'postgres'` is the
  queue entry; the API starts and cancels nothing.
- Worker: `WORKFLOW_ENGINE=postgres`, `AGENT_API_URL`, `AGENT_WORKER_SECRET`. The worker has no
  database connection. It claims runs through API procedures (`claimRuns`, `renewLease`,
  `releaseLease`) and writes finished operations through `saveCheckpoint`.
- How it works: the worker claims up to 10 runs every 2 seconds. A claim is a lease on the run row
  that lasts 60 seconds and is renewed every 20. If the worker dies, another claim takes the run
  after the lease ends and continues from the checkpoints. When a renewal fails for longer than
  the lease, the run stops on that worker and writes no status. Cancel is noticed at the next
  renewal. Agent and CLI nodes are polled in 5-minute pieces.
- Local: `WORKFLOW_ENGINE=postgres AGENT_API_URL=<api url> AGENT_WORKER_SECRET=<secret> bun run
  start` in `apps/agent-worker`.
- You give up Devs, which need Temporal. A checkpoint result larger than 1 MB is refused.
  Recovery after a hard kill takes up to the lease (60 seconds). A run that fails in an unexpected
  way keeps its lease until it expires, so it does not retry in a tight loop.

## Inngest

- API: `WORKFLOW_ENGINE=inngest`, `INNGEST_EVENT_KEY`. The API sends the event
  `workflow/run.requested` with the id `workflow-run-<runId>` (a repeat within 24 hours starts
  nothing) and cancels with `workflow/run.canceled`. `INNGEST_BASE_URL` points at a self-hosted
  Inngest server. `INNGEST_DEV=1` uses the local dev server and needs no key.
- Worker: `WORKFLOW_ENGINE=inngest`, `INNGEST_SIGNING_KEY` (also `INNGEST_BASE_URL`,
  `INNGEST_DEV`), `AGENT_API_URL`, `AGENT_WORKER_SECRET`. The worker joins with Inngest Connect: it
  dials out over a WebSocket and needs no public URL. Connect needs Node 22.4 or later. `inngest`
  is an external package in the worker bundle and is listed in
  `apps/agent-worker/container/package.json`, because the bundled copy crashes when it starts its
  worker thread.
- How it works: one function, `workflow-run`, with `retries: 3`. Each activity runs in a
  `step.run`. Our own retry loop runs inside the step and throws `NonRetriableError` when it gives
  up, so Inngest's retries only cover a lost worker. Agent and CLI nodes are polled in 30-minute
  pieces. A `NodeError` that crosses a step is encoded in the message as
  `[code,timed_out] message`, because Inngest keeps only the message.
- Local: `npx inngest-cli dev`, then run the API and the worker with `WORKFLOW_ENGINE=inngest
  INNGEST_DEV=1`. The run is visible at `http://localhost:8288`.
- You give up Devs without Temporal. Inngest limits a run to 1,000 steps, 4 MiB per step result and
  two hours per step; the 30-minute poll chunk keeps a graph of about 50 four-hour agent nodes
  under the step limit. After a worker crash Inngest took about two minutes to notice and re-run
  the interrupted step in our spike. A cancel does not stop a step that is already running; the
  next poll finds the run terminal at the API and ends.

## Trigger.dev

The only engine where the node work does not run in our worker.

- API: `WORKFLOW_ENGINE=trigger`, `TRIGGER_SECRET_KEY`. `TRIGGER_API_URL` only for a self-hosted
  Trigger.dev. The API calls `tasks.trigger("workflow-run", { runId }, { idempotencyKey })` and
  stores the handle id; cancel calls `runs.cancel`.
- The task: `apps/agent-worker/src/engines/trigger/tasks/workflowRun/`, configured in
  `apps/agent-worker/trigger.config.ts` (`TRIGGER_PROJECT_REF`, Node 24, `maxDuration` of 24 hours).
  Deploy it with `cd apps/agent-worker && TRIGGER_PROJECT_REF=<ref> bun run trigger:deploy`. This
  is a manual step; no workflow deploys it. Redeploy it whenever the interpreter changes.
- The task retries up to 5 times. Trigger.dev has no step memory, so a retry runs the function
  from the top and the checkpoints in our database make it continue. Agent and CLI nodes are
  polled in 5-minute pieces.
- You must set `AGENT_API_URL` and `AGENT_WORKER_SECRET` in the Trigger.dev project's environment
  variables, because the task calls our API. The worker secret can act for every organization, so
  it is then stored in a third party's system. That is acceptable for an operator's own account.
  It is the main reason Trigger.dev is not offered per organization.
- Local: `cd apps/agent-worker && bun run trigger:dev` against a Trigger.dev development project,
  with `TRIGGER_SECRET_KEY` on the API.
- You give up Devs without Temporal, and any worker process of ours: no worker needs to run for a
  `trigger` deployment.

## Switching engines

Change `WORKFLOW_ENGINE`, redeploy the API and the worker. New runs go to the new engine. A run in
flight finishes on the engine stored on its row, so keep a worker for the old engine up until
those runs end:

- Postgres and Inngest runs need a worker started with that `WORKFLOW_ENGINE`. The worker only
  claims or joins for the engine it was told to use, so a Postgres run left behind after a switch
  to `temporal` waits until a Postgres worker runs again. Cancel still works at once, because the
  API does it.
- Temporal runs need the worker with `TEMPORAL_ADDRESS` set. The worker starts its Temporal worker
  whenever the address is set.
- Trigger.dev runs need nothing from us, only the deployed task and the API URL it calls.

Rollback is a configuration change: set `WORKFLOW_ENGINE=temporal`. The columns and the checkpoint
table are additive and ignored by the Temporal path.

The Cloudflare deploy of the worker (`.github/workflows/deploy-production.yml`) runs when
`TEMPORAL_ADDRESS` or `WORKFLOW_ENGINE` is set, and passes the worker variables as secrets.

## Organization connections

An organization owner or admin can connect their own account in Settings, Integrations. Other
members see the card read-only. The connection applies to that organization only; others keep the
deployment engine. The node work still runs on our worker, which dials out to their account. They
deploy nothing.

The connection is stored in `workflow_engine_connections`, one row per organization. Secrets are
encrypted with `SECRETS_ENCRYPTION_KEY`; without it the connect procedure refuses. The API never
returns a secret, only the last four characters.

What an organization pastes:

- Inngest: an event key and a signing key. A collapsed "Self-hosted" section takes the base URL of
  their own Inngest server. The API tests the event key by sending one event named
  `workflow/connection.test`. The signing key can only be proven by the worker, so the card shows
  "Waiting for the worker to connect" until the worker joins.
- Temporal Cloud with an API key: address, namespace, API key. TLS is on.
- Temporal Cloud or self-hosted with a client certificate: address, namespace, client certificate
  and key in PEM form, and optionally a CA certificate. TLS is on.
- Self-hosted Temporal without authentication: address, namespace, and TLS on or off.

The API tests a Temporal connection by connecting and describing the namespace, with a 5-second
deadline. A failed test saves nothing.

How it runs:

- The worker lists the connections every 30 seconds. It starts an engine for a new or changed
  connection, stops one that was removed, and reports `connected` or `error` with the reason. A
  connection that fails to start is tried again every 5 minutes.
- For Inngest it opens one Connect session per connection with the organization's signing key.
- For Temporal it starts one worker per connection on the task queue `paradev-workflows`. It
  registers only `workflowRun` and the workflow activities, not `agentSession`, the reconcile
  schedule or `pdev`. Each such worker uses 2 workflow-task pollers and 2 activity-task pollers.
  A worker process holds at most `WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS` namespaces (default
  25). A connection over the limit is reported as `error` with "This deployment has reached its
  limit of connected Temporal namespaces."
- The worker dials out to their address. A self-hosted Temporal must therefore be reachable from
  this deployment's worker, not from the organization's laptop.
- The address of a Temporal connection and the base URL of an Inngest connection go through the
  same guard as the HTTP node: loopback, private, link-local, metadata and similar addresses are
  refused, at connect time and at every dial. `WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS=1` on the API
  and the worker turns the guard off, for a self-hosted deployment whose Temporal lives on the same
  private network.
- Step inputs and outputs are stored in their account (Inngest step results, Temporal activity
  results and history) and also in this platform's database (`workflow_run_steps`).
- Replacing or removing a connection is refused while a `pending` or `running` run uses it; the
  error says how many.
- There is no fallback. If their connection cannot start a run, the run fails with "Could not
  start the run on your Inngest connection: <reason>" (or Temporal). It does not run on the
  deployment engine, because that would hide a broken connection and put run state where the
  organization chose not to have it.

Why Trigger.dev and Postgres are not offered per organization:

- Trigger.dev executes our task code on its own machines inside the customer's project. That needs
  a way to build and deploy our task into each organization's project and redeploy it on every
  interpreter change; a worker credential limited to one organization, because the global
  `AGENT_WORKER_SECRET` cannot sit in a customer's project; and a compatibility contract between
  an old deployed task and a newer API. None of these exist.
- Postgres is this platform's own database. Pointing the journal at a customer's database gives
  them no dashboard and no control they lack today.

## Verification status

What has been run for real:

- Temporal through the shared interpreter: the Node test suite (`bun run test:node` in
  `apps/agent-worker`) with the Temporal test server.
- Postgres: unit and integration tests, and a reduced end-to-end on a throwaway database with three
  HTTP nodes and a worker restart in the middle.
- Inngest: a spike and an end-to-end against the Inngest dev server with stub activities, including
  a killed worker and a cancel. Two Connect sessions in one process with two clients worked
  against the dev server, which does not check keys.
- Temporal per organization: a per-connection worker against a local Temporal dev server with stub
  activities.
- The Settings card and its dialogs were built and typechecked with translations.

What has only been typechecked or unit-tested:

- Trigger.dev has never run. The adapter, `trigger.config.ts` and the task typecheck, and the
  journal and interpreter they use are tested. Nothing has talked to a Trigger.dev project, so the
  handle field (`handle.id`) and the base-URL handling come from reading the SDK types only.
- Temporal with an API key or with a client certificate (mTLS) has not been tried against a real
  server. Real Inngest signing keys and Inngest Cloud have not been tried either.
- The acceptance script with the real API, the desktop app and an agent node has not been run on
  any engine. In particular a SIGKILL takeover by lease expiry for Postgres, and a worker restart
  during an agent step with the real API, are untested outside the database-level test.
- The Settings UI has not been seen running in the desktop app.
- The `*.integration.ts` files under `packages/trpc/src/router/workflow*` need a database and are
  not part of `bun test`; they were not re-run after the SSRF guard moved to `packages/shared`.
- The deploy workflow changes for these variables have not run on GitHub.
