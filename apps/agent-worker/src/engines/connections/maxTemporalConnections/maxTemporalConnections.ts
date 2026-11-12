export function readMaxTemporalConnections(args: {
	env: NodeJS.ProcessEnv;
}): number | undefined {
	const raw = args.env.WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS;
	if (raw === undefined || raw === "") return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(
			`WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS must be a whole number of 0 or more; got ${raw}`,
		);
	}
	return value;
}
