# Let a deployment choose its durable execution engine for Workflows

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from AGENTS.md and the ExecPlan template (`/create-plan`).


## Purpose / Big Picture

Workflows are the canvas automations in this repo: a user draws a graph of nodes (trigger, agent, LLM, HTTP, condition, CLI) and the platform runs it. A run can last hours, so it needs a *durable execution engine*: a system that remembers which steps of a run are done, so that a crashed or redeployed process continues the run instead of starting it again.

Today the only engine is Temporal. A deployment without a Temporal server cannot run a single workflow; every dispatch fails with "Agents are not available here."

After this change, the person who operates a deployment sets one environment variable, `WORKFLOW_ENGINE`, to `postgres`, `temporal`, `inngest`, or `trigger`, and Workflows run on that engine. With `postgres` the only infrastructure needed is the database the app already has. To see it working: start the API and the agent worker with `WORKFLOW_ENGINE=postgres` and no Temporal, press "Run now" on a workflow in the desktop app, and watch the steps fill in; kill the worker in the middle of a run, start it again, and the run continues from the step it was on.

An organization can also bring its own engine account. In the desktop app, under Settings, an organization admin presses "Connect Inngest" or "Connect Temporal", pastes the credentials of their own Inngest account or their own Temporal namespace (Temporal Cloud or a self-hosted server), and from then on that organization's runs are orchestrated in their account and show up in their own Inngest or Temporal dashboard. The node work itself still executes on this platform's worker. Trigger.dev and Postgres are available only as the deployment-wide engine; the Decision Log says why.


## Assumptions

1. The agent worker (`apps/agent-worker`) stays the place where node work executes for the Temporal, Postgres and Inngest engines. It must not import the database client; it talks to the API with the worker secret. The Postgres engine therefore claims runs through API procedures and not with its own database connection.
2. Cloud "Devs" (the `agentSession` Temporal workflow in the same worker) stay on Temporal. A deployment that sets `WORKFLOW_ENGINE` to something else and has no `TEMPORAL_ADDRESS` gets Workflows without Devs.
3. All database work happens on a local development database or a fresh Neon branch only. This repository is a fork; nothing in this plan is pushed upstream or applied to a shared database.
4. Step results are delivered at least once on every engine. The one step that must not run twice, starting an agent, is protected by an idempotency key on the API side (see Plan of Work, Milestone 2).


## Open Questions

1. Inngest "Connect" (the worker mode that holds an outbound WebSocket instead of serving HTTP) has no general-availability label in its documentation. Milestone 5 starts with a spike; if Connect is not usable, the fallback is an HTTP `serve` endpoint on the worker's existing health-check port. Affects Milestone 5. Decision Log placeholder: "Inngest transport".
2. Whether a worker crash in the middle of an Inngest step with `retries: 0` loses the step or re-runs it. Affects the retry settings in Milestone 5. Decision Log placeholder: "Inngest retry policy".
4. Whether one worker process can hold several Inngest Connect connections at once, each with a different organization's signing key. Milestone 7 depends on it; the Milestone 5 spike must test two connections with two keys. If it cannot, per-organization Inngest falls back to one HTTP `serve` path per connection on the worker. Affects Milestone 7. Decision Log placeholder: "Inngest connections per process".
5. Which organization roles may connect an engine. The plan assumes owners and admins, using the same role check as the organization settings procedures in `packages/trpc/src/router/organization/organization.ts`. Affects Milestone 7.
3. The field name of the run id on the handle that Trigger.dev's `tasks.trigger` returns (`handle.id` is expected), and whether the SDK reads `TRIGGER_API_URL` for self-hosted servers. Affects Milestone 6. Decision Log placeholder: "Trigger.dev handle and base URL".


## Progress

- [x] (2026-11-12 17:21Z) Mapped the current Temporal-only engine and confirmed the Inngest and Trigger.dev SDK surfaces.
- [x] (2026-11-12 17:21Z) User decisions recorded: deployment-level switch first, shaped for a per-organization override; all four engines in this effort.
- [x] (2026-11-12 19:00Z) Milestone 1: engine-neutral graph interpreter; Temporal runs through it (commit 33b3a51c2).
- [ ] Milestone 2: database migration, engine registry in `packages/trpc`, API-side cancel cleanup.
- [x] (2026-11-12 19:50Z) Milestone 3: journaled context shared by the Postgres and Trigger.dev engines.
- [ ] Milestone 4: Postgres engine (completed: registry entry, claim/renew/release procedures, worker engine, main.ts composition root, unit and integration tests, a reduced end-to-end with three HTTP nodes and a worker restart on a throwaway database; remaining: the plan's acceptance with the real API, the desktop app and an agent node, and a SIGKILL takeover by lease expiry outside the DB-level test).
- [ ] Milestone 5: Inngest engine (completed: spike, API adapter, worker context and engine over Connect, terminal-run refusal for polls, env examples, container build with `inngest` external, end-to-end against the dev server with stub activities; remaining: acceptance with the real API, desktop app and an agent node; on `stop()` abort in-flight polls before draining, done in Milestone 7).
- [ ] Milestone 6: Trigger.dev engine (completed: API adapter, `trigger.config.ts`, the `workflow-run` task, scripts; typecheck only. remaining: any real run, which needs a Trigger.dev project).
- [x] (2026-11-12 18:10Z) User decision recorded: organizations can connect their own Inngest or Temporal from the UI; plan revised (Milestone 7 added).
- [ ] Milestone 7: per-organization Inngest and Temporal connections, with the Settings UI (completed: migration 0195 generated, connection storage and routing, `workflowEngine` router, worker connection manager, per-connection Temporal worker exercised against a local dev server with stub activities, Settings card and both dialogs with translations; remaining: re-run the four `*.integration.ts` files in `packages/trpc/src/router/workflow*` after the SSRF guard move, remove the `m7-throwaway` docker containers, see the UI running, the acceptance script with the real API, per-connection Inngest against the dev server, API-key and client-certificate Temporal).
- [x] (2026-11-13) Milestone 8: environment variables, documentation, checks (completed: the audit of the ten variables across schema, examples, worker passthrough and `deploy-production.yml`; the production deploy now passes them; error wording for a missing Temporal address and a missing Inngest signing key; `docs/workflow-engines.md`; the AGENTS.md link; checks run, see Outcomes. Not done: nothing was deployed, so the workflow edits have not run on GitHub, and the operator must create the secrets listed there).


## Surprises & Discoveries

- Observation: After a worker crash, Inngest takes about two minutes to notice and re-run the interrupted step.
  Evidence: Spike log: killed 17:50:46, step restarted 17:53:00.
- Observation: Inngest version 4 runs several steps inside one request ("checkpointing") and re-enters the function body only after a `step.sleep`; `triggers` is an array, `triggers: [{ event }]`.
  Evidence: Spike against `inngest` 4.26.2.
- Observation: The Inngest dev server reported "Completed" on `/v1/events/{id}/runs` for a run still in flight. Do not use that endpoint for status.
  Evidence: Spike.

- Observation: Trigger.dev has no step memoization inside one task. A retry runs the task function again from the first line.
  Evidence: Trigger.dev "How it works" documentation: "When retried, it starts from the beginning, but leverages cached results for completed subtasks."
- Observation: Inngest has no per-step retry override; `retries` is set per function and each step counts on its own.
  Evidence: Inngest `createFunction` reference and retries guide.
- Observation: the long agent poll is one Temporal activity of up to four hours, kept alive by heartbeats. No other engine has an equivalent, so the poll must be cut into bounded pieces.
  Evidence: `pollProxy` in `apps/agent-worker/src/workflows/workflowRun/workflowRun.ts`.


## Decision Log

- Decision: Worker-side engine starters take `activities` as a factory `(runtime) => WorkflowRunActivities`, and return an `EngineHandle` with `stop()`, `isRunning()` and `closed`.
  Rationale: Found in Milestone 4. Each run needs its own abort signal so cancel and `stop()` reach an in-flight poll; `main.ts` needs `isRunning` for the health server and `closed` to exit.
  Date/Author: 2026-11-13, Milestone 4 implementation.
- Decision: The Postgres engine polls in 5-minute chunks; a run that fails unexpectedly keeps its lease until it expires; a run aborts itself when lease renewals fail for longer than the lease.
  Rationale: Found in Milestone 4. Keeping the lease avoids a tight reclaim loop on a run that crashes every time.
  Date/Author: 2026-11-13, Milestone 4 implementation.
- Decision: Worker logs use a local `logError` helper in `apps/agent-worker/src/engines/logError`, not `rawErrorMessage`.
  Rationale: The worker does not depend on `@superset/i18n` and never produces translated messages.
  Date/Author: 2026-11-13, Milestone 4 implementation.

- Decision: `CallOptions.timeoutMs` bounds one try, not all tries; poll calls retry at most 10 times per chunk; a node that already failed is not re-marked canceled.
  Rationale: Found in Milestone 1. A total bound would remove the retries of the 30-second bookkeeping calls.
  Date/Author: 2026-11-13, Milestone 1 implementation.
- Decision: Database-backed lifecycle tests for cancel and the status guards live in `packages/trpc/src/router/workflow/workflowRunLifecycle.integration.ts`, which `bun test` does not pick up; run it by path with `DATABASE_URL` set.
  Rationale: CI has no database for the package suite and the repo forbids mocking the db client.
  Date/Author: 2026-11-13, Milestone 2 implementation.

- Decision: The engine is chosen per deployment by `WORKFLOW_ENGINE`; every run row stores the engine that started it.
  Rationale: The user asked for "both, deployment first". Storing the engine on the run makes cancel correct after an operator switches engines, and is the seam a per-organization override needs later.
  Date/Author: 2026-11-13, Ibe Dwi (answer to a planning question).
- Decision: Ship Temporal, Postgres, Inngest and Trigger.dev adapters in this effort.
  Rationale: User decision.
  Date/Author: 2026-11-13, Ibe Dwi.
- Decision: One graph interpreter, written against a small `DurableContext` interface, runs on every engine. Engines differ only in how they implement that interface.
  Rationale: Four copies of the topological loop would drift. The interpreter is the product behaviour; the engine is plumbing.
  Date/Author: 2026-11-13, plan author.
- Decision: Cancel cleanup moves from the Temporal workflow into the API (`finalizeCanceledRun`).
  Rationale: Inngest runs cleanup only in a second function, and Trigger.dev skips its `onCancel` hook when a run is suspended. The API already holds everything the cleanup needs, so one server-side function is correct for all engines.
  Date/Author: 2026-11-13, plan author.
- Decision: The Postgres engine is hand-written (a lease on the run row plus a checkpoint table) and not a library such as pg-boss or DBOS.
  Rationale: Those libraries need a direct database connection in the worker, which Assumption 1 forbids, and the Trigger.dev engine needs the same checkpoint table anyway.
  Date/Author: 2026-11-13, plan author.
- Decision: Organizations can connect their own Inngest account or Temporal namespace from Settings. Temporal means any Temporal: Temporal Cloud with an API key or client certificate, or a self-hosted server with or without TLS.
  Rationale: User decision. Both engines only orchestrate; the node code keeps running on this platform's worker, which dials out to the organization's account. No platform secret leaves the platform, so the blocker that the global worker secret would have to be handed to a third party does not apply.
  Date/Author: 2026-11-13, Ibe Dwi.
- Decision: Trigger.dev is a deployment-wide engine only; there is no "Connect Trigger.dev" for organizations in this plan.
  Rationale: Trigger.dev executes task code on its own machines inside the customer's project. A per-organization connection would need three things that do not exist: building and deploying our task into each organization's project and redeploying it on every change to the interpreter; a worker credential limited to one organization, because the deployed task must call our API and the global `AGENT_WORKER_SECRET` cannot be stored in a customer's project; and a compatibility contract between an old deployed task and a newer API. The realistic later route is a published task package that the organization deploys itself, once per-organization worker credentials exist.
  Date/Author: 2026-11-13, plan author.
- Decision: Postgres is a deployment-wide engine only.
  Rationale: The platform's own database already is that engine; pointing the journal at a customer's database gives them no dashboard and no control they do not already have.
  Date/Author: 2026-11-13, plan author.
- Decision: When an organization's connected engine cannot start a run, the run fails with a message naming the connection; it does not fall back to the deployment engine.
  Rationale: A silent fallback hides a broken connection and puts run state where the organization chose not to have it.
  Date/Author: 2026-11-13, plan author.
- Decision: Engine credentials are stored in a new table, encrypted with the existing `secret-box` helper, not in the `connections` or `integration_connections` tables.
  Rationale: Those tables model OAuth grants (access token, refresh token, external account) and store tokens as plain text. `packages/trpc/src/lib/secret-box.ts` already encrypts environment secrets with `SECRETS_ENCRYPTION_KEY`; `packages/shared/src/auth-token-crypto.ts` must not be used because its key is derived from the machine it runs on.
  Date/Author: 2026-11-13, plan author.
- Decision: Inngest connections per process: one `Inngest` client and one `connect()` call per connection, each with `handleShutdownSignals: []` and its own `instanceId`.
  Rationale: Spike, run against the dev server: two `connect()` calls in one process gave two active connections with events routed correctly. From the package source, the signing key belongs to the client and a `connect()` call authenticates with its first app's key only, so one call cannot serve two accounts. Real keys were not exercised (the dev server does not check them).
  Date/Author: 2026-11-13, Milestone 5 spike.
- Decision: Inngest transport: Connect. No HTTP fallback is built.
  Rationale: Spike: `connect()` worked under `node --import tsx` with `INNGEST_DEV=1`, connected in about 50 ms, and drained on `close()`.
  Date/Author: 2026-11-13, Milestone 5 spike.
- Decision: Inngest retry policy: function `retries: 3`; our own attempt loop runs inside the step handler and throws `NonRetriableError` (imported from `inngest`) when it gives up, so Inngest's retries cover only a lost worker.
  Rationale: Spike: with `retries: 0` a worker killed in the middle of a step failed the run after about 2 minutes with `connect_worker_stopped_responding`; with `retries: 3` the step ran again from its start after about 134 seconds and finished steps were not repeated.
  Date/Author: 2026-11-13, Milestone 5 spike.
- Decision: The worker procedures `observeAgent` and `pollHostJob` refuse with a non-retryable error when the run is already terminal.
  Rationale: Spike: an Inngest cancel does not stop a step handler that is already running, and plain code after that step still runs. A poll chunk of up to 30 minutes would keep polling a canceled run; refusing at the API ends it at the next poll on every engine.
  Date/Author: 2026-11-13, Milestone 5 spike.
- Decision: An organization connection is replaced or removed only when no run is `pending` or `running` on it; both procedures lock the connection row, count those runs, and refuse with the count. `updatedAt` is written by hand on connect (and by a passing `test` after an error) and never by a status write, because the worker restarts a connection's engine when it changes.
  Rationale: Runs find their account through the stored connection id, so swapping credentials under a live run would strand it. The worker reports status for the `updatedAt` it acted on, so a late report cannot overwrite a newer edit.
  Date/Author: 2026-11-13, Milestone 7 implementation.
- Decision: Connection workers on one process share one webpack bundle of `workflowRun` (`dist/workflow-bundle-connections.js` in a build, bundled once in memory from a checkout), and a connection engine that fails to start is retried every five minutes.
  Rationale: A bundle per connection costs seconds and memory each; a dead address must not be dialed every poll.
  Date/Author: 2026-11-13, Milestone 7 implementation.
- Decision: Trigger.dev handle and base URL: the run id is `handle.id`; the SDK reads `TRIGGER_API_URL` (default `https://api.trigger.dev`) and `TRIGGER_SECRET_KEY`. The adapter passes both with `auth.withAuth({ accessToken, baseURL }, fn)` so no global SDK state changes.
  Rationale: Read from the installed `@trigger.dev/core` 4.8.2 type definitions and `apiClientManager`.
  Date/Author: 2026-11-13, Milestone 6 implementation.
- Decision: `inngest` is external in the worker's `bun build` and listed in `apps/agent-worker/container/package.json`.
  Rationale: Bundled, `inngest/connect` crashed with "Worker thread exited with code 1 during connect": its worker thread loads a file from beside the module.
  Date/Author: 2026-11-13, Milestone 5 implementation.
- Decision: A `NodeError` crossing an Inngest step is encoded into the error message as `[code,timed_out] message` and decoded by the context.
  Rationale: Inngest keeps only the message of a step error.
  Date/Author: 2026-11-13, Milestone 5 implementation.


## Outcomes & Retrospective

What exists. The Workflows interpreter runs on four engines chosen by `WORKFLOW_ENGINE` (Temporal, Postgres, Inngest, Trigger.dev), with a default that keeps today's behaviour: Temporal when `TEMPORAL_ADDRESS` is set, Postgres otherwise. Every run records its engine and connection. Cancel is finished by the API. Organizations can connect their own Inngest or Temporal from Settings. `docs/workflow-engines.md` describes all of it, including a verification status section.

Environment. The ten variables are in `packages/trpc/src/env.ts` (the worker reads its own from `process.env`), in `.env.example` and `.env.local.example`, and in the worker passthrough in `apps/agent-worker/cloudflare/worker.ts`. Milestone 8 added the missing part: `deploy-production.yml` now passes the API variables (`WORKFLOW_ENGINE`, `INNGEST_EVENT_KEY`, `INNGEST_BASE_URL`, `INNGEST_DEV`, `TRIGGER_SECRET_KEY`, `TRIGGER_API_URL`, `WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS`) and the worker secrets (`WORKFLOW_ENGINE`, `INNGEST_SIGNING_KEY`, `INNGEST_BASE_URL`, `INNGEST_DEV`, `WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS`, `WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS`), and the worker job deploys when `TEMPORAL_ADDRESS` or `WORKFLOW_ENGINE` is set. `deploy-preview.yml` is unchanged on purpose: it threads no `TEMPORAL_*` either, because previews have no agent worker, and an engine secret there would send preview runs to the production account. `TRIGGER_PROJECT_REF` is read only by the manual `trigger:deploy` command, so no workflow carries it. Every variable is optional and a deploy that sets none behaves as before.

Error wording. The Inngest and Trigger.dev adapters already named the engine and the variable. The Temporal adapter did not (it surfaced "Agents are not available here."); it now says "Workflow engine temporal is not configured: TEMPORAL_ADDRESS is not set." The worker start-up error for a missing `INNGEST_SIGNING_KEY` now uses the same wording through `requireEngineEnv`. Each has a unit test.

Checks (2026-11-13). `bun run lint:fix`: no errors in tracked files; its 11 errors and 6 warnings are in the untracked `docs/pages/*.html`, which this work does not own. `bun run typecheck`: 42 of 42 tasks pass. `bunx turbo test --continue`: all suites in this branch's packages pass (`bun run test` stops at the first failing package, which hides later ones). Failures that exist without this branch, in code it does not touch: `rrule.test.ts` ("walks a BYHOUR list that wraps past midnight"), `agent-setup` shell-wrappers (3 tests), `desktop` shell-env ("getProcessEnvWithShellPath"), `host-service` pull-requests ("history accumulates across branch moves"). `check:i18n`, `sherif` and `check:plugins` pass. `bun run test:node` in `apps/agent-worker`: 15 of 15 pass.

Not verified. Trigger.dev has never run against a project. Temporal with an API key or a client certificate has not run against a real server. Real Inngest keys and Inngest Cloud have not been tried. The acceptance scripts with the real API, the desktop app and an agent node were not run on any engine. The Settings UI was not seen running. The four `*.integration.ts` files were not re-run after the SSRF guard moved. The `m7-throwaway` docker containers were not removed because the container engine was off limits. The deploy workflow edits have not run on GitHub.

Lessons. First, a root `bun test` is not the CI command and crashes Bun on the pty-daemon suite; use `bun run test` or `bunx turbo test --continue`. Second, a test that depends on an unset variable passes in CI and fails on a machine whose root `.env` sets it (`TEMPORAL_ADDRESS` here); give the code its input as a parameter, as the repo rules say. Third, the plan's step "both deploy workflows" did not fit when the existing Temporal variables were absent from one of them; copy the precedent, not the checklist, and record why. Fourth, an engine's worker only serves the engine it is told to use, so switching engines needs the old worker kept until its runs end; that is now in the documentation.


## Context and Orientation

This is a Turborepo monorepo that uses Bun. The affected app is `apps/agent-worker` (a long-running Node.js process) and, for one file, `apps/api` (the Next.js API). The affected packages are `packages/trpc` (the API's procedures; tRPC is the typed remote-procedure library this repo uses between its processes), `packages/db` (Drizzle ORM schema and migrations) and `packages/shared`. The desktop app is not changed.

How a run works today, with the file that owns each part:

A run starts in `dispatchWorkflow` in `packages/trpc/src/router/workflow/dispatch.ts`. It inserts a row in the `workflow_runs` table with status `pending`, then calls Temporal: `agentTemporal().workflow.start("workflowRun", …)`. `agentTemporal` in `packages/trpc/src/lib/agent-runtime/temporal.ts` throws when `TEMPORAL_ADDRESS` is unset.

The run executes in `apps/agent-worker`. `src/main.ts` connects to Temporal and registers two things. The first is the *workflow function* `workflowRun` in `src/workflows/workflowRun/workflowRun.ts`: it loads the graph, walks it in topological order (a node runs when all nodes that point at it are done), and for each node calls *activities*. The second is the activities themselves, made by `createWorkflowActivities` in `src/activities/workflowActivities/workflowActivities.ts`. An activity is an ordinary async function that does real work (start an agent, poll it, call an HTTP URL); Temporal records each activity result so a restarted workflow function does not repeat it.

Activities never touch the database. They call the API through `src/clients/workflowApi/workflowApi.ts`, which sends the header `x-agent-worker-secret`. The API side is `workflowWorkerRouter` in `packages/trpc/src/router/workflow/worker.ts` (procedures `loadRun`, `recordRunStatus`, `recordStep`, `dispatchAgent`, `observeAgent`, `readHostFile`, `agentTranscript`, `execHostJob`, `pollHostJob`, `killHostJob`, `llmCall`). Run and step status live in the tables `workflow_runs` and `workflow_run_steps` in `packages/db/src/schema/schema.ts`; the desktop app reads them.

Cancel is `cancelRun` in `packages/trpc/src/router/workflow/run.ts`. It writes status `canceled` and calls `handle.cancel()` on the Temporal workflow; the workflow function then kills running CLI jobs and marks steps canceled.

So Temporal appears in exactly four places: the start in `dispatch.ts`, the cancel in `run.ts`, the workflow function, and the worker boot in `main.ts`. The activities import Temporal only for three small things: `ApplicationFailure` to mark an error retryable or not, and `Context.current()` for heartbeat, cancellation and sleep.

Terms used below. A *durable context* is the object the interpreter uses to do anything with a side effect; it has two operations, "call this activity" and "sleep", and the engine guarantees that an operation that finished is not done again after a crash. A *journal* is a table of finished operations keyed by run and operation key; engines without their own memory of steps use it. A *lease* is a claim on a run row with an expiry time, so two workers do not run the same run and a dead worker's run is picked up by another.

Facts about the two hosted engines that the design relies on, stated here so the reader needs no external documentation:

Inngest (npm package `inngest`, version 4, Node 20 or later). You create a client, `new Inngest({ id })`, and define a function with `inngest.createFunction({ id, triggers: { event }, retries, cancelOn: [{ event, match: "data.runId" }] }, async ({ event, step }) => { … })`. Inside, `step.run(id, handler)` runs `handler` once and stores its JSON result; on every later re-entry the stored result is returned. `step.sleep(id, duration)` suspends the run. Parallel steps are `Promise.all` over several `step.run` calls. A run starts when another process calls `inngest.send({ id, name, data })`; a repeated `id` within 24 hours starts nothing. Sending the `cancelOn` event stops the run; no code in the function runs after that. Limits: 1,000 steps per run, 4 MiB per step result, 32 MiB of state per run, two hours per step. A worker joins with `connect({ apps: [{ client, functions }] })` from `inngest/connect`, which needs Node 22.4 or later and no public URL. Environment: `INNGEST_EVENT_KEY` to send, `INNGEST_SIGNING_KEY` for the worker, `INNGEST_BASE_URL` and `INNGEST_DEV=0` for a self-hosted server, `INNGEST_DEV=1` for the local dev server started with `npx inngest-cli dev`.

Trigger.dev (npm package `@trigger.dev/sdk`, version 4, imported from the package root). You define `task({ id, retry, maxDuration, run: async (payload, { signal }) => { … } })` in a directory named in `trigger.config.ts`, and deploy it to a Trigger.dev project with `npx trigger.dev@latest deploy`; the task then runs on Trigger.dev's machines, not in our worker. Another process starts it with `tasks.trigger("task-id", payload, { idempotencyKey })`, which needs `TRIGGER_SECRET_KEY`, and cancels it with `runs.cancel(runId)`. There is no step memory: a retry runs `run` again from the top. Environment variables the task needs are set in the Trigger.dev project, not read from our deploy.


## Plan of Work

The work is eight milestones. Each leaves the repository working and is committed on its own; follow the additive-then-subtractive order inside each one (add the new path, prove it, then delete the old).


### Milestone 1: an engine-neutral interpreter, with Temporal running through it

At the end of this milestone nothing new is visible to a user, but the graph-walking logic no longer imports Temporal, and Temporal executes it through an adapter. The existing Temporal tests still pass, which proves no behaviour was lost.

Create `apps/agent-worker/src/engines/` with one folder per unit, following the repository rule of one folder per module with an `index.ts` barrel.

`engines/durableContext/durableContext.ts` defines the interface (full signatures in Interfaces and Dependencies). It has no imports from any engine.

`engines/runGraph/runGraph.ts` holds `runGraph({ ctx, runId })`. Move the body of `workflowRun` here and change it in four ways. First, every `quick.x(…)`, `dispatch.x(…)`, `capture.x(…)` and proxy call becomes `ctx.call("x", input, { key, timeoutMs, attempts })`. The `key` is a stable string unique within the run: `<nodeId>:<operation>` with a counter suffix for repeated operations, for example `fetch-issue:record:running`, `review:dispatch`, `review:await:3`. Second, the two long polls become loops. `awaitAgentNode` and `pollCliNode` gain an input `budgetMs` and return with a "still running" result when the budget is used; `runGraph` calls them repeatedly with `budgetMs = ctx.pollChunkMs` until the node's own timeout (agent at most 4 hours, CLI at most 2 hours) is used up, counting used time as the sum of the budgets so the count is the same on a replay. `pollCliNode` also takes and returns the output `offset` so the next chunk continues where the last stopped. Third, errors: replace `ApplicationFailure` with a plain class `NodeError` (`engines/nodeError/nodeError.ts`) that carries `code`, `retryable` and `timedOut`, and replace `isCancellation(error)` with `ctx.isCancellation(error)`. Fourth, delete the cancel cleanup block; on cancellation `runGraph` rethrows and does nothing else, because Milestone 2 moves cleanup to the API. Until Milestone 2 lands, keep the old cleanup in the Temporal adapter so the tree is never without it.

In `apps/agent-worker/src/activities/workflowActivities/workflowActivities.ts`, remove the two Temporal imports. Add to `WorkflowActivityDeps` a field `runtime?: () => ActivityRuntime` where `ActivityRuntime` is `{ heartbeat(): void; signal: AbortSignal; sleep(ms: number): Promise<void> }`; the three private helpers at the bottom of the file use it, with a default that never aborts and sleeps with `setTimeout`. Throw `NodeError` where the file throws `ApplicationFailure`.

`engines/temporal/` is the adapter. `temporalContext.ts` implements `DurableContext` with `proxyActivities` (`call` builds a proxy with `scheduleToCloseTimeout: timeoutMs`, `retry.maximumAttempts: attempts`, and for the two poll activities `heartbeatTimeout: "1 minute"` and `WAIT_CANCELLATION_COMPLETED`, exactly the options `pollProxy` uses today), `sleep` from `@temporalio/workflow`, and `pollChunkMs` of 15 minutes. `apps/agent-worker/src/workflows/workflowRun/workflowRun.ts` shrinks to a function that builds this context and calls `runGraph`. `temporalActivities.ts` wraps `createWorkflowActivities` with the Temporal `Context`-based `runtime` and converts a thrown `NodeError` into `ApplicationFailure.nonRetryable` or `.retryable`. `main.ts` uses this wrapper.

Everything `runGraph` imports must stay free of Node.js built-ins, because Temporal bundles workflow code for a sandbox (`scripts/bundleWorkflows.ts`).

Tests. Add `engines/runGraph/runGraph.test.ts`, a bun test that drives `runGraph` with an in-memory context (`engines/testing/memoryContext.ts`: `call` invokes fake activities directly, `sleep` resolves at once). Cover one behaviour per test: a linear graph, two parallel branches, a condition that skips a subtree, a failed node failing the run, an agent that needs three poll chunks, and an agent that exhausts its timeout. Update `workflowRun.node-test.ts` only where fake activities need the new `budgetMs` shape.

Acceptance:

    cd apps/agent-worker
    bun test src/engines
    bun run test:node
    bun run typecheck
    # Expected: all pass; grep finds no "@temporalio" import outside src/engines/temporal, src/workflows, src/main.ts and the agentSession files.


### Milestone 2: database, engine registry, and API-side cancel

At the end of this milestone the API chooses an engine by name, records it on the run, and cancel works without help from the engine. Temporal is still the only registered engine.

Database. In `packages/db/src/schema/schema.ts` add to `workflowRuns`: `engine text not null default 'temporal'`, `engineRunId text` (the engine's own id for the run, when it has one), `leaseOwner text` and `leaseExpiresAt timestamptz` (used only by the Postgres engine), and a partial index on `(created_at)` where `engine = 'postgres' and status in ('pending','running')` so claiming does not scan finished runs. Add to `workflowRunSteps`: `externalRef jsonb` (the agent handle or the CLI job that the step started; cancel needs it). Add a table `workflowRunCheckpoints` with `runId uuid` (foreign key to `workflow_runs`, cascade delete), `key text`, `result jsonb`, `createdAt`, primary key `(runId, key)`. Adding a column with a constant default does not rewrite the table in current PostgreSQL, so the migration is safe under load. Generate the migration by following `.agents/skills/db-migrations/SKILL.md` on a fresh Neon branch; never hand-edit `packages/db/drizzle/`; apply it to the local development database only.

Registry. Create `packages/trpc/src/lib/workflow-engine/` with `types.ts` (the `WorkflowEngine` interface below), `resolveWorkflowEngine.ts`, and one file per engine under `engines/`. `resolveWorkflowEngine({ organizationId })` returns the engine named by `env.WORKFLOW_ENGINE`; when the variable is unset it returns `temporal` if `TEMPORAL_ADDRESS` is set and `postgres` otherwise. It takes `organizationId` and ignores it; that parameter is the seam for the later per-organization override. `workflowEngineById(id)` returns the adapter for a stored `engine` value. Each adapter loads its SDK with a dynamic `import()` inside `start` and `cancel`, so a deployment does not load three SDKs it does not use. `engines/temporal.ts` moves the existing `workflow.start` and `handle.cancel` calls here unchanged.

Add `WORKFLOW_ENGINE` (enum, optional) to `packages/trpc/src/env.ts`. Read `docs/environment-variables.md` first: a new variable must be added in five places and a missed one fails silently.

`dispatchWorkflow` in `packages/trpc/src/router/workflow/dispatch.ts`: resolve the engine before the insert, write `engine` into the row, call `engine.start({ runId, organizationId })` where it calls Temporal now, and store a returned `engineRunId`.

Cancel. Add `packages/trpc/src/router/workflow/finalizeCanceledRun.ts`. In one transaction it sets the run to `canceled` if it is `pending` or `running`, sets every step of the run that is `pending` or `running` to `canceled`, and deletes the run's checkpoints. After the transaction it kills each CLI job named in those steps' `externalRef` through the same relay call `killHostJob` uses, ignoring a job that is already gone. It is safe to call twice. `cancelRun` in `run.ts` becomes: load the run with its `engine` and `engineRunId`, call `workflowEngineById(run.engine).cancel(…)` inside a try that logs with `rawErrorMessage` (never an empty catch), then call `finalizeCanceledRun`.

Guards in `packages/trpc/src/router/workflow/worker.ts`, so a late write from an activity that was in flight cannot undo a cancel: `recordRunStatus` updates only where the current status is `pending` or `running`, and `recordStep` does nothing when the run is already terminal. Both return `{ recorded: false }` in that case instead of throwing. `execHostJob` and `dispatchAgent` write `externalRef` on the step row. `dispatchAgent` also becomes idempotent on `(runId, nodeId)`: when the step row already has an agent handle in `externalRef`, return it and start nothing. That is what makes "start an agent" safe on engines that deliver at least once. When a run reaches a terminal status, `recordRunStatus` deletes its checkpoints.

Now remove the cleanup block kept in the Temporal adapter in Milestone 1.

These procedures are called only by our own worker, and every change is additive or a no-op for old callers; still read `packages/trpc/AGENTS.md` before editing them.

Tests, in `packages/trpc/src/router/workflow/workflow.test.ts` or a sibling: cancel marks running steps canceled and is repeatable; a `recordStep` after cancel leaves the step canceled; a second `dispatchAgent` for the same node returns the first handle. Do not `mock.module` the env or the database client; pass the engine in as a parameter where a test needs a fake one.

Acceptance:

    bun test packages/trpc/src/router/workflow
    cd apps/agent-worker && bun run test:node
    # Then, with local Temporal (cd apps/agent-worker && bun run temporal:dev, bun run start):
    # run a workflow with a long agent node, cancel it in the desktop app, and see the
    # run and its running step show "canceled"; the row has engine = 'temporal'.


### Milestone 3: the journaled context

Postgres and Trigger.dev both lack step memory, so they share one implementation of `DurableContext` that stores finished operations in `workflow_run_checkpoints` through the API.

API: add to `workflowWorkerRouter` the procedures `loadCheckpoints({ runId })` returning `{ key, result }[]`, and `saveCheckpoint({ runId, key, result })`, an insert that does nothing on conflict and refuses a result larger than 1 MB. Add both to `WorkflowApi` in `apps/agent-worker/src/clients/workflowApi/workflowApi.ts`.

Worker: `engines/journal/journaledContext.ts` exports `createJournaledContext({ api, activities, runId, signal, sleep, pollChunkMs })`. On creation it loads all checkpoints into a map. `call` returns the stored result when the key is present; otherwise it runs the activity with a retry loop (up to `attempts`, exponential backoff from one second, no retry when a `NodeError` says `retryable: false`), enforces `timeoutMs` by racing a timer and throwing a `NodeError` with `timedOut: true`, saves the checkpoint, and returns. A failed operation is not stored; a re-run after a crash tries it again. `sleep(key, ms)` stores the wake-up time under the key before waiting, so a re-run waits only for the remainder. When `signal` aborts, every pending and later operation throws an error that `isCancellation` recognises. The injected `sleep` is what lets tests run with no real waiting.

Tests (`journaledContext.test.ts`, bun, in-memory fake of the two API calls): a second context for the same run does not call an activity whose checkpoint exists; retries stop on a non-retryable error; a timeout produces `timedOut`; abort rejects.

Acceptance:

    cd apps/agent-worker && bun test src/engines/journal


### Milestone 4: the Postgres engine

At the end of this milestone a deployment with no Temporal runs workflows. This is the milestone that delivers the "just PostgreSQL" promise.

API side. `packages/trpc/src/lib/workflow-engine/engines/postgres.ts`: `start` does nothing, because a `pending` row with `engine = 'postgres'` is itself the queue entry; `cancel` does nothing, because the worker notices the terminal status when it renews its lease. Add three worker procedures. `claimRuns({ workerId, limit, leaseSeconds })` runs one statement: update `workflow_runs` set the lease where the id is in a sub-select of rows with `engine = 'postgres'`, status `pending` or `running`, and no lease or an expired one, ordered by `created_at`, limited, with `FOR UPDATE SKIP LOCKED` (the PostgreSQL clause that makes concurrent claimers skip rows another transaction has locked instead of waiting), returning the ids. `renewLease({ runId, workerId, leaseSeconds })` extends the lease only while the owner matches and the run is not terminal, and returns `{ held: boolean }`. `releaseLease({ runId, workerId })` clears it.

Worker side. `engines/postgres/postgresEngine.ts` exports `startPostgresEngine({ api, activities, workerId, pollEveryMs, leaseSeconds, maxConcurrentRuns, sleep })` returning `{ stop(): Promise<void> }`. A loop calls `claimRuns` every `pollEveryMs` (default 2 seconds) for as many runs as it has free slots (default 10). For each claimed run it creates an `AbortController`, a journaled context, and calls `runGraph`. A timer renews the lease every third of `leaseSeconds` (default 60); when `renewLease` returns `held: false` the run was canceled or taken over, so the controller aborts and the run stops without writing status. `stop()` stops claiming, aborts running runs, releases their leases, and resolves; another worker, or this one after restart, claims them and continues from the journal.

`apps/agent-worker/src/main.ts` becomes a small composition root. Move the current body into `engines/temporal/startTemporalWorker.ts`. `main.ts` reads `WORKFLOW_ENGINE` with the same default rule as the API, starts the Temporal worker when `TEMPORAL_ADDRESS` is set (Devs need it regardless of the workflow engine), starts the selected non-Temporal engine, and wires `SIGINT`/`SIGTERM` to every `stop()`. The `pdev` binary version check moves into `startTemporalWorker`, so a Postgres-only worker does not need `pdev`. The health server reports up when every started engine is running.

Tests (`postgresEngine.test.ts`, bun, fake API, injected sleep, tiny intervals): a claimed run runs to `succeeded`; a run whose lease renewal returns `held: false` stops and writes no status; `stop()` releases leases. One API test for `claimRuns`: two concurrent claims never return the same run.

Acceptance, with no Temporal process running:

    # terminal 1: bun dev (API with WORKFLOW_ENGINE=postgres, TEMPORAL_ADDRESS unset)
    # terminal 2:
    cd apps/agent-worker
    WORKFLOW_ENGINE=postgres AGENT_API_URL=<api url> AGENT_WORKER_SECRET=<secret> bun run start
    # Desktop app: open a workflow with trigger -> http -> agent, press Run now.
    # Expected: steps go running -> succeeded. While the agent step is running, stop
    # terminal 2 with Ctrl-C and start it again: the run continues, the http step is not
    # called a second time, and no second agent workspace appears.


### Milestone 5: the Inngest engine

Spike first, two hours at most, in a scratch file that is not committed: start `npx inngest-cli dev`, connect a worker with `connect()`, run a function with two steps and a sleep, kill the worker in the middle of a step, and send the cancel event. Record in Surprises & Discoveries whether Connect works under `node --import tsx`, and what happens to the interrupted step with `retries: 0` and with `retries: 3`. Fill the two Decision Log placeholders.

API side: add the `inngest` dependency to `packages/trpc`. `engines/inngest.ts`: `start` sends `{ id: "workflow-run-<runId>", name: "workflow/run.requested", data: { runId } }` and returns the event id as `engineRunId`; `cancel` sends `{ name: "workflow/run.canceled", data: { runId } }`. New optional env: `INNGEST_EVENT_KEY`, `INNGEST_BASE_URL`, `INNGEST_DEV`.

Worker side: add `inngest` to `apps/agent-worker`. `engines/inngest/inngestContext.ts` implements `DurableContext`: `call` is `step.run(key, handler)` where the handler does the same in-process retry loop and timeout as the journaled context (extract that loop into `engines/journal/attempt.ts` and use it from both), and throws Inngest's `NonRetriableError` once our own attempts are used so Inngest does not multiply them; `sleep` is `step.sleep(key, ms)`; `pollChunkMs` is 30 minutes, which keeps a graph of 50 agent nodes at four hours each under Inngest's limit of 1,000 steps per run (about 8 polls and 6 other steps per node). `engines/inngest/inngestEngine.ts` defines the function with id `workflow-run`, the trigger and `cancelOn` above with `match: "data.runId"`, and `startInngestEngine` calls `connect()` and returns `{ stop }` that closes the connection. If the spike rules Connect out, serve the function with the SDK's Node HTTP handler on the port the health server already uses, and document that the Inngest server must be able to reach the worker.

Cancellation in Inngest stops the function without running any of its code, which is why cleanup lives in `finalizeCanceledRun`.

Tests: one bun test of `inngestContext` with a fake `step` object whose `run` memoizes by id. Do not add a test that needs an Inngest server.

Acceptance: same manual script as Milestone 4 with `WORKFLOW_ENGINE=inngest INNGEST_DEV=1` on both processes and `npx inngest-cli dev` running; the run is also visible in the Inngest dev UI at `http://localhost:8288`.


### Milestone 6: the Trigger.dev engine

Trigger.dev runs the task on its own machines, so this engine does not use our worker process at all; the task is deployed code that calls our API.

API side: add `@trigger.dev/sdk` to `packages/trpc`. `engines/trigger.ts`: `start` calls `tasks.trigger("workflow-run", { runId }, { idempotencyKey: "workflow-run-<runId>" })` and returns the handle's run id as `engineRunId`; `cancel` calls `runs.cancel(engineRunId)`. New optional env: `TRIGGER_SECRET_KEY`, `TRIGGER_API_URL`. Confirm the handle field and the base-URL variable against the installed package's types and fill the Decision Log placeholder.

Task: add `@trigger.dev/sdk` and `@trigger.dev/build` to `apps/agent-worker`. Create `apps/agent-worker/trigger.config.ts` with `runtime: "node-24"`, `dirs: ["./src/engines/trigger/tasks"]`, and the project ref from `process.env.TRIGGER_PROJECT_REF`. Create `apps/agent-worker/src/engines/trigger/tasks/workflowRun.ts`: a task with id `workflow-run`, `retry: { maxAttempts: 5 }`, whose `run(payload, { signal })` builds `workflowApi` from `AGENT_API_URL` and `AGENT_WORKER_SECRET`, builds the activities and a journaled context with that `signal`, and calls `runGraph`. Because a retry runs the function from the top, the journal is what makes the retry continue instead of repeat. Set `pollChunkMs` to 5 minutes. Add the script `"trigger:deploy": "trigger deploy"` and `"trigger:dev": "trigger dev"` to `apps/agent-worker/package.json`.

The operator must set `AGENT_API_URL` and `AGENT_WORKER_SECRET` in the Trigger.dev project's environment variables. State plainly in the documentation (Milestone 8) what that means: the worker secret, which can act for every organization, is then stored in a third party's system. That is acceptable for an operator's own account and is the main reason the per-organization override needs per-organization secrets before it can exist.

Tests: none beyond typecheck for the task wrapper; its parts (`runGraph`, the journaled context) are already covered.

Acceptance: `cd apps/agent-worker && bun run trigger:dev` with a Trigger.dev development project, `WORKFLOW_ENGINE=trigger` and `TRIGGER_SECRET_KEY` on the API; run a workflow from the desktop app; steps fill in, and cancel from the desktop app ends the Trigger.dev run.


### Milestone 7: organizations connect their own Inngest or Temporal

At the end of this milestone an organization admin can connect the organization's own Inngest account or Temporal namespace in Settings, and that organization's runs are orchestrated there. Other organizations keep using the deployment engine.

The model. A *workflow engine connection* is one row per organization that names a provider (`inngest` or `temporal`), holds non-secret settings in the clear and secrets encrypted, and carries a health status. The Temporal and Inngest engines from Milestones 2 and 5 are reused unchanged in behaviour; what changes is that each call receives the connection to use, or none for the deployment-wide account.

Database (a second migration, same rules as Milestone 2: follow `.agents/skills/db-migrations/SKILL.md`, local database or a Neon branch only). New table `workflowEngineConnections` in `packages/db/src/schema/schema.ts`: `id`, `organizationId` (foreign key, cascade delete, unique: one connection per organization), `provider text`, `config jsonb`, `encryptedCredentials text`, `status text` (`pending`, `connected`, `error`), `lastError text`, `lastCheckedAt`, `connectedByUserId`, `createdAt`, `updatedAt`. For Inngest, `config` is `{ baseUrl?: string }` (set only for a self-hosted Inngest server) and the credentials are `{ eventKey, signingKey }`. For Temporal, `config` is `{ address, namespace, tls: boolean, serverName?: string }` and the credentials are any of `{ apiKey?, clientCertPem?, clientKeyPem?, serverRootCaPem? }`; an API key is how Temporal Cloud usually authenticates, a client certificate and key is the other Temporal Cloud method and the common one for a self-hosted server, and a plain self-hosted server needs neither. Add `workflow_runs.engineConnectionId uuid` (nullable, foreign key with `ON DELETE SET NULL`, with an index because of that foreign key). Encrypt and decrypt with `packages/trpc/src/lib/secret-box.ts`; when `SECRETS_ENCRYPTION_KEY` is not set the connect procedure refuses with a message that says so.

Resolution. `resolveWorkflowEngine({ organizationId })` in `packages/trpc/src/lib/workflow-engine/` becomes async and returns `{ engine, connection }`: when the organization has a connection, the engine for its provider and the decrypted connection; otherwise the deployment engine and `null`. `WorkflowEngine.start` and `.cancel` gain a `connection` argument. `dispatchWorkflow` writes `engineConnectionId` on the run; `cancelRun` loads the connection named on the run, so a run is always canceled in the account that holds it. The Temporal adapter keeps one cached client per connection id and `updatedAt` (and one for the deployment); the Inngest adapter builds a client with the connection's `eventKey` and `baseUrl`. When the connection's engine rejects the start, the run fails with "Could not start the run on your Inngest connection: <reason>" (or Temporal) and nothing falls back.

Outbound address safety. A Temporal address and an Inngest base URL are hosts that an organization types in and that the API and worker then dial, so they need the same guard the HTTP node has. Move `apps/agent-worker/src/activities/workflowActivities/ssrf.ts` and its test to `packages/shared/src/ssrf/` (export `"./ssrf"` in `packages/shared/package.json`) and add `assertPublicHost({ host, resolveHost })` beside `assertPublicUrl`. The connect procedure and both dial sites call it. A new environment variable `WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS=1` turns the guard off, for a self-hosted deployment whose Temporal lives on the same private network.

API procedures. New router `workflowEngine` in `packages/trpc/src/router/workflow-engine/`, registered in `packages/trpc/src/root.ts`; all are new, so released clients are unaffected. `get` returns provider, config, status, `lastError` and the last four characters of each secret, never a secret. `connect` takes a discriminated union on `provider`, checks the caller's organization role, runs the address guard, tests the credentials, encrypts, and upserts the row with status `pending`. `test` repeats the check for the stored connection. `disconnect` refuses while the organization has `pending` or `running` runs on the connection and reports how many; otherwise it deletes the row. The credential test for Temporal connects and asks the server to describe the namespace, with a five-second deadline passed in as a parameter so the test suite can use a tiny one. For Inngest it sends one event named `workflow/connection.test` with the event key; the signing key can only be proven by the worker, which is what the status field is for. Add to `workflowWorkerRouter`: `listEngineConnections()` returning every connection with decrypted credentials, and `reportEngineConnection({ connectionId, status, error })`. `loadRun` also returns `engineConnectionId`.

Worker. `apps/agent-worker/src/engines/connections/connectionManager.ts` exports `startConnectionManager({ api, activities, startInngest, startTemporal, pollEveryMs, maxTemporalConnections })` returning `{ stop }`. Every `pollEveryMs` (default 30 seconds) it calls `listEngineConnections`, and compares the result with what is running, keyed by connection id and `updatedAt`: it starts an engine for a new or changed connection, stops one that disappeared, and reports `connected` or `error` with the reason. For Inngest it calls the Milestone 5 `startInngestEngine` with that organization's signing key and base URL. For Temporal it calls a new `startWorkflowTemporalWorker` in `engines/temporal/` that connects to the organization's address and namespace and registers only the `workflowRun` workflow and the workflow activities on the task queue `paradev-workflows`; it does not register the `agentSession` workflow, the reconcile schedule, or `pdev`, because those belong to this platform's own Temporal. Each such worker sets `maxConcurrentWorkflowTaskPolls: 2` and `maxConcurrentActivityTaskPolls: 2` to keep an idle connection cheap. `maxTemporalConnections` (default 25, env `WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS`) bounds how many a single worker process holds; a connection over the bound is reported as `error` with "This deployment has reached its limit of connected Temporal namespaces." `main.ts` starts the manager beside the deployment engine. The Temporal start in the API adapter uses the same task queue name for a connection, and the deployment's own queue otherwise.

The organization must not need to deploy anything for either provider: their account stores the run history and timers, and this platform's worker does the work. Say so in the dialog.

Desktop UI. Read `apps/desktop/AGENTS.md` and the existing page first, then add a card to the Integrations settings page: `apps/desktop/src/renderer/routes/_authenticated/settings/integrations/components/WorkflowEngineCard/` with `WorkflowEngineCard.tsx` and `index.ts`, and under its own `components/` one folder each for `ConnectInngestDialog` and `ConnectTemporalDialog` (one component per file, one folder per component). With no connection the card shows the sentence "Workflows run on the built-in engine." and two buttons, "Connect Inngest" and "Connect Temporal". The Inngest dialog has fields for event key and signing key and a collapsed "Self-hosted" section with the base URL. The Temporal dialog has address, namespace, and an authentication choice of "API key", "Client certificate" (two PEM text areas, plus an optional CA certificate) or "None", and a TLS switch that is on and locked for the first two. Submitting calls `workflowEngine.connect`; a failed test shows the provider's error under the form and saves nothing. With a connection the card shows the provider, the address or "Inngest Cloud", a status dot (`pending`: "Waiting for the worker to connect", `connected`, `error` with `lastError`), and buttons "Test" and "Disconnect"; while status is `pending` the query refetches every two seconds. Members who are not owners or admins see the card read-only. Use the shadcn primitives in `packages/ui/src/components/ui/`. Every string goes through Lingui (`<Trans>` or `t`), then run `bun run check:i18n` and write the translations into every `locales/<locale>/messages.po` yourself; "Inngest" and "Temporal" are product names and are added to `packages/i18n/glossary.md` as terms that never translate. Secrets are never put in persisted renderer state.

Tests. In `packages/trpc`: `resolveWorkflowEngine` prefers the organization's connection; `get` never returns a secret; `disconnect` refuses with runs in flight; a member without the role is refused; a private address is refused unless the override is set. In `apps/agent-worker`, `connectionManager.test.ts` with fake starters and an injected timer: a new connection starts an engine and reports `connected`, a changed `updatedAt` restarts it, a removed connection stops it, a starter that throws reports `error`, and the Temporal bound is enforced. Verify the UI in the running desktop app by following `.agents/skills/cdp-verification/SKILL.md`.

Acceptance:

    # Deployment engine is postgres. Start a second, separate local Temporal:
    #   temporal server start-dev --port 7244 --ui-port 8244
    # API and worker run with WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS=1 and SECRETS_ENCRYPTION_KEY set.
    # Desktop: Settings -> Integrations -> Connect Temporal, address localhost:7244,
    # namespace default, authentication None. The card goes from "Waiting for the worker
    # to connect" to connected within about 30 seconds.
    # Run a workflow: it succeeds, appears in the Temporal UI at http://localhost:8244,
    # and its row has engine = 'temporal' and engine_connection_id set.
    # A workflow in a second organization still runs with engine = 'postgres'.
    # Disconnect while a run is in flight is refused with the count; after the run ends it works.
    # Repeat with Connect Inngest against `npx inngest-cli dev` (base URL http://localhost:8288).


### Milestone 8: environment, documentation, checks

Follow `docs/environment-variables.md` for every new variable (`WORKFLOW_ENGINE`, `INNGEST_*`, `TRIGGER_*`, `WORKFLOW_ENGINE_ALLOW_PRIVATE_HOSTS`, `WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS`): `.env.example`, the env schemas, and both deploy workflows; read `docs/deploy-workflows.md` before editing a workflow file. Add `docs/workflow-engines.md`: one section per engine with what to set on the API, what to run as the worker, what you give up (Devs without Temporal; the step limit on Inngest; the secret placement on Trigger.dev), and how to switch engines (runs in flight finish on the engine stored on their row, so keep the old worker running until they are done). Link it from the "Further reading" list in `AGENTS.md`. Add a section on organization connections: what an organization pastes for Inngest and for each kind of Temporal, that the worker dials out to their account so a self-hosted Temporal must be reachable from this deployment, that step inputs and outputs are then stored in their account as well as in this platform's database, and why Trigger.dev is not offered per organization (the three needs in the Decision Log).

When a dispatch is rejected because the selected engine is not configured, the error stored on the run must name the engine and the missing variable, for example "Workflow engine inngest is not configured: INNGEST_EVENT_KEY is not set." No user-facing strings change in the desktop app, so `check:i18n` should report nothing new; run it anyway.

Acceptance: run `/ci-check` (lint:fix, typecheck, test, check:i18n, sherif) and see it pass.


## Concrete Steps

Run from the repository root unless a step says otherwise.

    git status                      # on feat/workflows-shared-graph or a branch from it; never push upstream
    bun install                     # after adding inngest and @trigger.dev/* dependencies
    bun run typecheck
    bun run lint
    bun test
    cd apps/agent-worker && bun run test:node

Milestone 2 migration: follow `.agents/skills/db-migrations/SKILL.md` step by step. Expected result is one new numbered SQL file under `packages/db/drizzle/` that adds four columns to `workflow_runs`, one column to `workflow_run_steps`, one table and one index, and nothing else.

Commit after each milestone with a conventional message, for example `refactor(agent-worker): run workflow graphs through an engine-neutral interpreter`.


## Validation and Acceptance

Each milestone lists its own acceptance. The whole plan is accepted when all of the following are observed on a local stack:

With `WORKFLOW_ENGINE=postgres` and no Temporal running, a three-node workflow (trigger, HTTP, agent) started with "Run now" reaches `succeeded`, and survives a worker restart during the agent step without repeating the HTTP step or starting a second agent.

With `WORKFLOW_ENGINE=temporal`, the same workflow behaves as it did before this plan, and `bun run test:node` in `apps/agent-worker` passes.

With `WORKFLOW_ENGINE=inngest` against the Inngest dev server, and with `WORKFLOW_ENGINE=trigger` against a Trigger.dev development project, the same workflow reaches `succeeded`.

On every engine, cancelling a run during an agent or CLI step shows the run and that step as `canceled` in the desktop app within a few seconds, and a CLI job that was running on the host is killed.

`select engine, count(*) from workflow_runs group by engine` on the local database shows one row per engine exercised.

With the deployment on `postgres`, an organization that connects its own Temporal or Inngest in Settings gets its next run in that account, visible in that provider's own UI, while a second organization's runs stay on `postgres`.

    bun run typecheck   # no errors
    bun run lint        # no errors
    bun test            # all pass, no test waits on a real timer or network


## Idempotence and Recovery

Every step can be repeated. `dispatchWorkflow` is already safe against replays through the unique indexes on `workflow_runs`; engine starts are idempotent by construction (Temporal `USE_EXISTING`, Inngest event id, Trigger.dev idempotency key, and for Postgres the row itself). `finalizeCanceledRun`, `saveCheckpoint`, `dispatchAgent` and the lease procedures are written to be called twice with the same result.

Rollback is a configuration change: set `WORKFLOW_ENGINE=temporal`. The new columns and table are additive and are ignored by the Temporal path, so the code can also be reverted without reverting the migration. If the migration itself must be undone on the local database, generate a new migration that drops the additions; do not edit or delete the generated files by hand.

If a milestone is interrupted, the `Progress` section must say which files are done; the tree compiles at every commit because each milestone adds the new path before removing the old.


## Artifacts and Notes

Operation keys the interpreter produces for one agent node named `review`, in order:

    review:record:running
    review:dispatch
    review:await:0
    review:await:1
    review:capture
    review:record:succeeded

The claim statement for the Postgres engine, in SQL for clarity (write it with Drizzle in the procedure):

    UPDATE workflow_runs
       SET lease_owner = $worker, lease_expires_at = now() + make_interval(secs => $lease)
     WHERE id IN (
             SELECT id FROM workflow_runs
              WHERE engine = 'postgres'
                AND status IN ('pending', 'running')
                AND (lease_expires_at IS NULL OR lease_expires_at < now())
              ORDER BY created_at
              LIMIT $limit
              FOR UPDATE SKIP LOCKED)
    RETURNING id;


## Interfaces and Dependencies

New dependencies, pinned to an exact version as this repository does: `inngest` (4.x) in `packages/trpc` and `apps/agent-worker`; `@trigger.dev/sdk` (4.x) in both; `@trigger.dev/build` (same version) as a dev dependency of `apps/agent-worker`. Run `bun run sherif` afterwards; it fails when two workspaces pin different versions of one package. No library is added for the Postgres engine.

In `apps/agent-worker/src/engines/durableContext/durableContext.ts`:

    export interface CallOptions {
        /** Unique within the run and the same on every replay. */
        key: string;
        timeoutMs: number;
        /** Total tries, counting the first. */
        attempts: number;
    }

    export interface DurableContext {
        call<K extends keyof WorkflowRunActivities>(
            name: K,
            input: Parameters<WorkflowRunActivities[K]>[0],
            options: CallOptions,
        ): Promise<Awaited<ReturnType<WorkflowRunActivities[K]>>>;
        sleep(key: string, ms: number): Promise<void>;
        isCancellation(error: unknown): boolean;
        /** Longest single poll call this engine allows. */
        readonly pollChunkMs: number;
    }

In `apps/agent-worker/src/engines/runGraph/runGraph.ts`:

    export function runGraph(args: { ctx: DurableContext; runId: string }): Promise<void>;

In `apps/agent-worker/src/engines/nodeError/nodeError.ts`:

    export class NodeError extends Error {
        constructor(args: { message: string; code: string; retryable: boolean; timedOut?: boolean });
        readonly code: string;
        readonly retryable: boolean;
        readonly timedOut: boolean;
    }

Every worker-side engine starter has the same shape, which is what lets `main.ts` compose them:

    export function startPostgresEngine(deps: { … }): Promise<{ stop(): Promise<void> }>;
    export function startInngestEngine(deps: { … }): Promise<{ stop(): Promise<void> }>;
    export function startTemporalWorker(deps: { … }): Promise<{ stop(): Promise<void>; isRunning(): boolean }>;

In `packages/trpc/src/lib/workflow-engine/types.ts`:

    export const WORKFLOW_ENGINE_IDS = ["temporal", "postgres", "inngest", "trigger"] as const;
    export type WorkflowEngineId = (typeof WORKFLOW_ENGINE_IDS)[number];

    export interface WorkflowEngine {
        id: WorkflowEngineId;
        /** Must be safe to call twice for one run. */
        start(args: { runId: string; organizationId: string }): Promise<{ engineRunId?: string }>;
        /** Stops the engine's execution. Database cleanup is finalizeCanceledRun's job. */
        cancel(args: { runId: string; engineRunId: string | null }): Promise<void>;
    }

    export function resolveWorkflowEngine(args: { organizationId: string }): WorkflowEngine;
    export function workflowEngineById(id: WorkflowEngineId): WorkflowEngine;

From Milestone 7 the same file changes to carry the organization's connection; `connection` is `null` for the deployment-wide account:

    export type WorkflowEngineConnection =
        | { id: string; provider: "inngest"; baseUrl?: string; eventKey: string; signingKey: string }
        | {
              id: string;
              provider: "temporal";
              address: string;
              namespace: string;
              tls: boolean;
              serverName?: string;
              apiKey?: string;
              clientCertPem?: string;
              clientKeyPem?: string;
              serverRootCaPem?: string;
          };

    start(args: { runId: string; organizationId: string; connection: WorkflowEngineConnection | null }): Promise<{ engineRunId?: string }>;
    cancel(args: { runId: string; engineRunId: string | null; connection: WorkflowEngineConnection | null }): Promise<void>;

    export function resolveWorkflowEngine(args: { organizationId: string }): Promise<{ engine: WorkflowEngine; connection: WorkflowEngineConnection | null }>;

The `workflowEngine` router (`packages/trpc/src/router/workflow-engine/`) has `get`, `connect`, `test` and `disconnect`. `workflowWorkerRouter` gains `listEngineConnections` and `reportEngineConnection` in Milestone 7.

New procedures on `workflowWorkerRouter` (`packages/trpc/src/router/workflow/worker.ts`), all `workerProcedure` mutations: `loadCheckpoints`, `saveCheckpoint`, `claimRuns`, `renewLease`, `releaseLease`. Changed, compatibly: `recordRunStatus` and `recordStep` return `{ recorded: boolean }`; `dispatchAgent` returns the existing handle on a repeat; `awaitAgentNode` and `pollCliNode` (worker activities, not procedures) take `budgetMs`.

Code conventions from `AGENTS.md` that apply throughout: functions with two or more parameters take one object; no `as any`, no `@ts-ignore`, no empty catch; comments only for a constraint the code cannot express; logs use `rawErrorMessage`, never `errorMessage`; tests co-located, one behaviour each, no raised timeouts, no `mock.module` of shared modules.


## Revision Notes

2026-11-13: Added Milestone 7 (organizations connect their own Inngest or Temporal from Settings) and renumbered the documentation milestone to 8. The first draft stopped at a deployment-wide switch and only left a seam for a per-organization override; the user then asked for a "Connect Inngest" style button and for Temporal of any kind. Purpose, Open Questions, Progress, Decision Log, Validation and Interfaces were updated to match. Trigger.dev and Postgres stay deployment-wide, with the reasons recorded in the Decision Log.

2026-11-13: Milestone 8 done. Added the production deploy passthrough for the engine variables, Temporal and worker error wording, `docs/workflow-engines.md`, and the AGENTS.md link; filled Outcomes & Retrospective. The plan stays in `plans/` because the acceptance scripts of Milestones 4 to 7 have not been run.
