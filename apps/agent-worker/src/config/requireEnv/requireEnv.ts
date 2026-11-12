export function requireEnv(args: {
	env: NodeJS.ProcessEnv;
	name: string;
}): string {
	const value = args.env[args.name];
	if (!value) throw new Error(`${args.name} is not set`);
	return value;
}

export function requireEngineEnv(args: {
	env: NodeJS.ProcessEnv;
	engine: string;
	name: string;
}): string {
	const value = args.env[args.name];
	if (!value) {
		throw new Error(
			`Workflow engine ${args.engine} is not configured: ${args.name} is not set.`,
		);
	}
	return value;
}
