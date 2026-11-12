export const WORKFLOW_CONNECTION_TASK_QUEUE = "paradev-workflows";

export interface InngestEngineConnection {
	id: string;
	provider: "inngest";
	/** Opaque; changes whenever the organization edits the connection. */
	updatedAt: string;
	baseUrl?: string;
	eventKey: string;
	signingKey: string;
}

export interface TemporalEngineConnection {
	id: string;
	provider: "temporal";
	updatedAt: string;
	address: string;
	namespace: string;
	tls: boolean;
	serverName?: string;
	apiKey?: string;
	clientCertPem?: string;
	clientKeyPem?: string;
	serverRootCaPem?: string;
}

export type WorkflowEngineConnection =
	| InngestEngineConnection
	| TemporalEngineConnection;
