const WORKFLOW_ENGINE_IDS = [
	"temporal",
	"postgres",
	"inngest",
	"trigger",
] as const;

export type WorkflowEngineId = (typeof WORKFLOW_ENGINE_IDS)[number];

export interface EngineSelection {
	workflowEngine: WorkflowEngineId;
	startTemporal: boolean;
	startPostgres: boolean;
	startInngest: boolean;
}

/** Same default as the API: temporal when an address is set, postgres otherwise. */
export function selectEngines(args: {
	env: NodeJS.ProcessEnv;
}): EngineSelection {
	const configured = args.env.WORKFLOW_ENGINE || undefined;
	const address = args.env.TEMPORAL_ADDRESS || undefined;
	const workflowEngine = pickEngine({ configured, address });
	return {
		workflowEngine,
		startTemporal: address !== undefined || workflowEngine === "temporal",
		startPostgres: workflowEngine === "postgres",
		startInngest: workflowEngine === "inngest",
	};
}

function pickEngine(args: {
	configured: string | undefined;
	address: string | undefined;
}): WorkflowEngineId {
	if (args.configured === undefined) {
		return args.address ? "temporal" : "postgres";
	}
	const found = WORKFLOW_ENGINE_IDS.find((id) => id === args.configured);
	if (!found) {
		throw new Error(
			`WORKFLOW_ENGINE must be one of ${WORKFLOW_ENGINE_IDS.join(", ")}; got ${args.configured}`,
		);
	}
	return found;
}
