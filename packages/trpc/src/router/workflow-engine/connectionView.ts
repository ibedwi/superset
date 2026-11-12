import type { WorkflowEngineConnection } from "@superset/shared/workflow-engine";
import type { ConnectionRow } from "../../lib/workflow-engine/connections";
import {
	inngestConfigSchema,
	temporalConfigSchema,
} from "../../lib/workflow-engine/connections/schemas";

export type WorkflowEngineConnectionStatus = "pending" | "connected" | "error";

interface ConnectionViewBase {
	id: string;
	status: WorkflowEngineConnectionStatus;
	/** Why the worker could not connect; null unless status is "error". */
	lastError: string | null;
	lastCheckedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	/** Runs on this connection that have not finished; a connection with any cannot be replaced or removed. */
	activeRuns: number;
}

export type InngestConnectionView = ConnectionViewBase & {
	provider: "inngest";
	config: { baseUrl: string | null };
	/** Last four characters of each secret, or null when too short to show safely. */
	secretHints: { eventKey: string | null; signingKey: string | null };
};

export type TemporalConnectionView = ConnectionViewBase & {
	provider: "temporal";
	config: {
		address: string;
		namespace: string;
		tls: boolean;
		serverName: string | null;
		authentication: "api_key" | "client_certificate" | "none";
		hasCustomCa: boolean;
	};
	secretHints: { apiKey: string | null };
};

export type WorkflowEngineConnectionView =
	| InngestConnectionView
	| TemporalConnectionView;

const MIN_LENGTH_FOR_HINT = 12;

export function lastFour(secret: string | undefined): string | null {
	if (!secret || secret.length < MIN_LENGTH_FOR_HINT) return null;
	return secret.slice(-4);
}

function connectionStatus(value: string): WorkflowEngineConnectionStatus {
	return value === "connected" || value === "error" ? value : "pending";
}

/**
 * Builds what a client may see. `secrets` is only read for the last four
 * characters; it is null when the stored credentials cannot be decrypted.
 */
export function toConnectionView(args: {
	row: ConnectionRow;
	secrets: WorkflowEngineConnection | null;
	activeRuns: number;
}): WorkflowEngineConnectionView {
	const { row, secrets } = args;
	const base: ConnectionViewBase = {
		id: row.id,
		status: connectionStatus(row.status),
		lastError: row.lastError,
		lastCheckedAt: row.lastCheckedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		activeRuns: args.activeRuns,
	};
	if (row.provider === "inngest") {
		const config = inngestConfigSchema.parse(row.config);
		const inngest = secrets?.provider === "inngest" ? secrets : undefined;
		return {
			...base,
			provider: "inngest",
			config: { baseUrl: config.baseUrl ?? null },
			secretHints: {
				eventKey: lastFour(inngest?.eventKey),
				signingKey: lastFour(inngest?.signingKey),
			},
		};
	}
	const config = temporalConfigSchema.parse(row.config);
	const temporal = secrets?.provider === "temporal" ? secrets : undefined;
	return {
		...base,
		provider: "temporal",
		config: {
			address: config.address,
			namespace: config.namespace,
			tls: config.tls,
			serverName: config.serverName ?? null,
			authentication: temporal?.apiKey
				? "api_key"
				: temporal?.clientCertPem
					? "client_certificate"
					: "none",
			hasCustomCa: Boolean(temporal?.serverRootCaPem),
		},
		secretHints: { apiKey: lastFour(temporal?.apiKey) },
	};
}
