import type { WorkflowEngineConnection } from "@superset/shared/workflow-engine";
import { z } from "zod";

export const inngestConfigSchema = z.object({
	baseUrl: z.string().optional(),
});

export const inngestCredentialsSchema = z.object({
	eventKey: z.string().min(1),
	signingKey: z.string().min(1),
});

export const temporalConfigSchema = z.object({
	address: z.string().min(1),
	namespace: z.string().min(1),
	tls: z.boolean(),
	serverName: z.string().optional(),
});

export const temporalCredentialsSchema = z.object({
	apiKey: z.string().optional(),
	clientCertPem: z.string().optional(),
	clientKeyPem: z.string().optional(),
	serverRootCaPem: z.string().optional(),
});

type WithoutIdentity<T> = T extends unknown
	? Omit<T, "id" | "updatedAt">
	: never;

/** A connection before it is stored: no id and no version yet. */
export type WorkflowEngineConnectionDraft =
	WithoutIdentity<WorkflowEngineConnection>;

export type StoredConnectionParts =
	| {
			provider: "inngest";
			config: z.infer<typeof inngestConfigSchema>;
			credentials: z.infer<typeof inngestCredentialsSchema>;
	  }
	| {
			provider: "temporal";
			config: z.infer<typeof temporalConfigSchema>;
			credentials: z.infer<typeof temporalCredentialsSchema>;
	  };

function defined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

export function splitConnection(
	draft: WorkflowEngineConnectionDraft,
): StoredConnectionParts {
	if (draft.provider === "inngest") {
		return {
			provider: "inngest",
			config: defined({ baseUrl: draft.baseUrl }),
			credentials: {
				eventKey: draft.eventKey,
				signingKey: draft.signingKey,
			},
		};
	}
	return {
		provider: "temporal",
		config: defined({
			address: draft.address,
			namespace: draft.namespace,
			tls: draft.tls,
			serverName: draft.serverName,
		}),
		credentials: defined({
			apiKey: draft.apiKey,
			clientCertPem: draft.clientCertPem,
			clientKeyPem: draft.clientKeyPem,
			serverRootCaPem: draft.serverRootCaPem,
		}),
	};
}

export function joinConnection(args: {
	id: string;
	updatedAt: string;
	provider: string;
	config: unknown;
	credentials: unknown;
}): WorkflowEngineConnection {
	const identity = { id: args.id, updatedAt: args.updatedAt };
	if (args.provider === "inngest") {
		const config = inngestConfigSchema.parse(args.config);
		const credentials = inngestCredentialsSchema.parse(args.credentials);
		return defined({
			...identity,
			provider: "inngest" as const,
			baseUrl: config.baseUrl,
			...credentials,
		});
	}
	if (args.provider === "temporal") {
		const config = temporalConfigSchema.parse(args.config);
		const credentials = temporalCredentialsSchema.parse(args.credentials);
		return defined({
			...identity,
			provider: "temporal" as const,
			...config,
			...credentials,
		});
	}
	throw new Error(`Unknown engine provider ${args.provider}`);
}
