import { db } from "@superset/db/client";
import { workflows, workflowTriggers } from "@superset/db/schema";
import { findProviderIdentity } from "@superset/db/utils";
import {
	accountAllows,
	configHasMeScope,
	type MatchableEvent,
	resolveMeScopes,
	triggerMatches,
} from "@superset/shared/automation-matching";
import { Client } from "@upstash/qstash";
import { and, eq, isNull, or } from "drizzle-orm";
import { env } from "@/env";

const qstash = new Client({
	token: env.QSTASH_TOKEN,
	baseUrl: env.QSTASH_URL,
});

export function workflowDispatchBatch(
	matched: Array<{ workflowId: string; triggerId: string }>,
	eventId: string,
	apiUrl: string,
) {
	return matched.map((candidate) => ({
		url: `${apiUrl}/api/workflows/dispatch/${candidate.workflowId}`,
		body: {
			workflowId: candidate.workflowId,
			triggerId: candidate.triggerId,
			eventId,
		},
		// One run per trigger per event, however many times the provider
		// redelivers or the sweep republishes.
		deduplicationId: `${candidate.triggerId}_${eventId}`,
		retries: 2,
	}));
}

/**
 * The workflow half of event dispatch. The sibling of
 * `dispatchMatchingTriggers`, with two deliberate differences: it never marks
 * the event dispatched (the automation matcher owns that, and runs after
 * this), and it declines deliveries addressed to one automation or trigger by
 * URL — those URLs name automations, not workflows.
 */
export async function dispatchMatchingWorkflowTriggers(params: {
	organizationId: string;
	eventId: string;
	event: MatchableEvent;
	automationId?: string;
	triggerId?: string;
	ownerUserId?: string;
	integrationConnectionId?: string | null;
}): Promise<{ matched: number; considered: number }> {
	if (params.automationId || params.triggerId) {
		return { matched: 0, considered: 0 };
	}
	// TODO(workflows): plan-tier gating, once workflows have a launch plan.

	const { event } = params;
	const candidates = await db
		.select({
			triggerId: workflowTriggers.id,
			config: workflowTriggers.config,
			connectionId: workflowTriggers.connectionId,
			workflowId: workflows.id,
			ownerUserId: workflows.ownerUserId,
		})
		.from(workflowTriggers)
		.innerJoin(workflows, eq(workflows.id, workflowTriggers.workflowId))
		.where(
			and(
				eq(workflowTriggers.organizationId, params.organizationId),
				eq(workflowTriggers.kind, event.provider),
				eq(workflows.enabled, true),
				isNull(workflows.archivedAt),
				params.ownerUserId
					? eq(workflows.ownerUserId, params.ownerUserId)
					: undefined,
				params.integrationConnectionId
					? or(
							isNull(workflowTriggers.connectionId),
							eq(
								workflowTriggers.connectionId,
								params.integrationConnectionId,
							),
						)
					: isNull(workflowTriggers.connectionId),
			),
		);
	if (candidates.length === 0) return { matched: 0, considered: 0 };

	const meIds = new Map<string, Promise<string | null>>();
	const meIdFor = (ownerUserId: string) => {
		let pending = meIds.get(ownerUserId);
		if (!pending) {
			pending = findProviderIdentity({
				organizationId: params.organizationId,
				userId: ownerUserId,
				provider: event.provider,
			}).then((identity) => identity?.externalId ?? null);
			meIds.set(ownerUserId, pending);
		}
		return pending;
	};
	const resolved = await Promise.all(
		candidates.map(async (candidate) => {
			if (!configHasMeScope(candidate.config)) return candidate;
			const meId = await meIdFor(candidate.ownerUserId);
			return { ...candidate, config: resolveMeScopes(candidate.config, meId) };
		}),
	);

	const matched = resolved.filter(
		(candidate) =>
			accountAllows(candidate.connectionId, params.integrationConnectionId) &&
			triggerMatches(candidate.config, event).matches,
	);
	if (matched.length === 0) {
		return { matched: 0, considered: candidates.length };
	}

	await qstash.batchJSON(
		workflowDispatchBatch(matched, params.eventId, env.NEXT_PUBLIC_API_URL),
	);
	return { matched: matched.length, considered: candidates.length };
}
