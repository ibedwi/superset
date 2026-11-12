import { db, dbWs } from "@superset/db/client";
import { workflowEngineConnections, workflowRuns } from "@superset/db/schema";
import { rawErrorMessage } from "@superset/i18n/errors";
import type { ResolveHost } from "@superset/shared/ssrf";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, count, eq, inArray } from "drizzle-orm";
import { env } from "../../env";
import { secretsKeyConfigured } from "../../lib/secret-box";
import {
	assertConnectionHostAllowed,
	privateHostsAllowed,
	type WorkflowEngineConnection,
	type WorkflowEngineId,
} from "../../lib/workflow-engine";
import {
	type ConnectionRow,
	connectionFromRow,
	findConnectionRow,
	sealCredentials,
	splitConnection,
	type WorkflowEngineConnectionDraft,
} from "../../lib/workflow-engine/connections";
import { testWorkflowEngineConnection } from "../../lib/workflow-engine/connectionTest";
import { defaultWorkflowEngineId } from "../../lib/workflow-engine/resolveWorkflowEngine";
import { personProcedure } from "../../trpc";
import { verifyOrgAdmin, verifyOrgMembership } from "../integration/utils";
import { requireActiveOrgId } from "../utils/active-org";
import {
	toConnectionView,
	type WorkflowEngineConnectionView,
} from "./connectionView";
import { connectInput, type ParsedWorkflowEngineConnectInput } from "./schema";

const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;
const PROVIDER_LABELS = { inngest: "Inngest", temporal: "Temporal" } as const;

export interface WorkflowEngineRouterDeps {
	testConnection: (args: {
		connection: WorkflowEngineConnection;
	}) => Promise<void>;
	allowPrivateHosts: () => boolean;
	resolveHost?: ResolveHost;
	secretsConfigured: () => boolean;
	deploymentEngine: () => WorkflowEngineId;
}

const defaultDeps: WorkflowEngineRouterDeps = {
	testConnection: testWorkflowEngineConnection,
	allowPrivateHosts: privateHostsAllowed,
	secretsConfigured: secretsKeyConfigured,
	deploymentEngine: () =>
		defaultWorkflowEngineId({
			configured: env.WORKFLOW_ENGINE,
			temporalAddress: env.TEMPORAL_ADDRESS,
		}),
};

function toDraft(
	input: ParsedWorkflowEngineConnectInput,
): WorkflowEngineConnectionDraft {
	if (input.provider === "inngest") {
		return {
			provider: "inngest",
			eventKey: input.eventKey,
			signingKey: input.signingKey,
			...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
		};
	}
	const { provider: _provider, ...settings } = input;
	return {
		provider: "temporal",
		address: settings.address,
		namespace: settings.namespace,
		tls: settings.tls,
		...(settings.serverName ? { serverName: settings.serverName } : {}),
		...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
		...(settings.clientCertPem
			? { clientCertPem: settings.clientCertPem }
			: {}),
		...(settings.clientKeyPem ? { clientKeyPem: settings.clientKeyPem } : {}),
		...(settings.serverRootCaPem
			? { serverRootCaPem: settings.serverRootCaPem }
			: {}),
	};
}

const activeRunsOn = (connectionId: string) =>
	and(
		eq(workflowRuns.engineConnectionId, connectionId),
		inArray(workflowRuns.status, [...ACTIVE_RUN_STATUSES]),
	);

async function countActiveRuns(connectionId: string): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(workflowRuns)
		.where(activeRunsOn(connectionId));
	return row?.total ?? 0;
}

function openQuietly(row: ConnectionRow): WorkflowEngineConnection | null {
	try {
		return connectionFromRow(row);
	} catch (error) {
		console.warn(
			"[workflowEngine] stored credentials cannot be read",
			row.id,
			rawErrorMessage(error),
		);
		return null;
	}
}

async function viewOf(
	row: ConnectionRow,
): Promise<WorkflowEngineConnectionView> {
	return toConnectionView({
		row,
		secrets: openQuietly(row),
		activeRuns: await countActiveRuns(row.id),
	});
}

function runsInFlightError(args: { count: number; action: string }) {
	const noun = args.count === 1 ? "run is" : "runs are";
	return new TRPCError({
		code: "CONFLICT",
		message: `${args.count} ${noun} still in progress on this connection. Wait for ${args.count === 1 ? "it" : "them"} to finish or cancel ${args.count === 1 ? "it" : "them"}, then ${args.action}.`,
	});
}

export function createWorkflowEngineRouter(
	overrides: Partial<WorkflowEngineRouterDeps> = {},
) {
	const deps: WorkflowEngineRouterDeps = { ...defaultDeps, ...overrides };

	async function checkReachable(connection: WorkflowEngineConnection) {
		await assertConnectionHostAllowed({
			connection,
			allowPrivateHosts: deps.allowPrivateHosts(),
			resolveHost: deps.resolveHost,
		});
		await deps.testConnection({ connection });
	}

	return {
		get: personProcedure.query(async ({ ctx }) => {
			const organizationId = requireActiveOrgId(ctx);
			const { membership } = await verifyOrgMembership(
				ctx.session.user.id,
				organizationId,
			);
			const row = await findConnectionRow({ organizationId });
			return {
				connection: row ? await viewOf(row) : null,
				canManage: membership.role === "admin" || membership.role === "owner",
				canStoreSecrets: deps.secretsConfigured(),
				deploymentEngine: deps.deploymentEngine(),
			};
		}),

		connect: personProcedure
			.input(connectInput)
			.mutation(async ({ ctx, input }) => {
				const organizationId = requireActiveOrgId(ctx);
				await verifyOrgAdmin(ctx.session.user.id, organizationId);
				if (!deps.secretsConfigured()) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This deployment cannot store engine credentials: SECRETS_ENCRYPTION_KEY is not set.",
					});
				}

				const draft = toDraft(input);
				const candidate: WorkflowEngineConnection = {
					...draft,
					id: "pending",
					updatedAt: "pending",
				};
				try {
					await checkReachable(candidate);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Could not connect to ${PROVIDER_LABELS[draft.provider]}: ${rawErrorMessage(error)}`,
					});
				}

				const parts = splitConnection(draft);
				const now = new Date();
				const saved = await dbWs.transaction(async (tx) => {
					const [existing] = await tx
						.select({ id: workflowEngineConnections.id })
						.from(workflowEngineConnections)
						.where(eq(workflowEngineConnections.organizationId, organizationId))
						.for("update");
					if (existing) {
						const [active] = await tx
							.select({ total: count() })
							.from(workflowRuns)
							.where(activeRunsOn(existing.id));
						if (active && active.total > 0) {
							throw runsInFlightError({
								count: active.total,
								action: "connect again",
							});
						}
					}
					const values = {
						provider: parts.provider,
						config: parts.config,
						encryptedCredentials: sealCredentials({
							organizationId,
							credentials: parts.credentials,
						}),
						status: "pending",
						lastError: null,
						lastCheckedAt: now,
						connectedByUserId: ctx.session.user.id,
						updatedAt: now,
					};
					const [row] = await tx
						.insert(workflowEngineConnections)
						.values({ organizationId, ...values })
						.onConflictDoUpdate({
							target: workflowEngineConnections.organizationId,
							set: values,
						})
						.returning({ id: workflowEngineConnections.id });
					return row;
				});
				if (!saved) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "The connection was not saved.",
					});
				}
				const row = await findConnectionRow({ organizationId });
				if (!row) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "The connection was not saved.",
					});
				}
				return { connection: await viewOf(row) };
			}),

		test: personProcedure.mutation(async ({ ctx }) => {
			const organizationId = requireActiveOrgId(ctx);
			await verifyOrgAdmin(ctx.session.user.id, organizationId);
			const row = await findConnectionRow({ organizationId });
			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No engine is connected.",
				});
			}
			const checkedAt = new Date();
			let error: string | null = null;
			try {
				const connection = connectionFromRow(row);
				await checkReachable(connection);
			} catch (caught) {
				error = rawErrorMessage(caught);
			}
			const retryWorker = error === null && row.status === "error";
			await db
				.update(workflowEngineConnections)
				.set({
					lastCheckedAt: checkedAt,
					...(retryWorker
						? { status: "pending", lastError: null, updatedAt: checkedAt }
						: {}),
				})
				.where(eq(workflowEngineConnections.id, row.id));
			const fresh = await findConnectionRow({ organizationId });
			return {
				ok: error === null,
				error,
				checkedAt,
				connection: await viewOf(fresh ?? row),
			};
		}),

		disconnect: personProcedure.mutation(async ({ ctx }) => {
			const organizationId = requireActiveOrgId(ctx);
			await verifyOrgAdmin(ctx.session.user.id, organizationId);
			await dbWs.transaction(async (tx) => {
				const [existing] = await tx
					.select({ id: workflowEngineConnections.id })
					.from(workflowEngineConnections)
					.where(eq(workflowEngineConnections.organizationId, organizationId))
					.for("update");
				if (!existing) return;
				const [active] = await tx
					.select({ total: count() })
					.from(workflowRuns)
					.where(activeRunsOn(existing.id));
				if (active && active.total > 0) {
					throw runsInFlightError({
						count: active.total,
						action: "disconnect",
					});
				}
				await tx
					.delete(workflowEngineConnections)
					.where(eq(workflowEngineConnections.id, existing.id));
			});
			return { disconnected: true as const };
		}),
	} satisfies TRPCRouterRecord;
}

export const workflowEngineRouter = createWorkflowEngineRouter();
