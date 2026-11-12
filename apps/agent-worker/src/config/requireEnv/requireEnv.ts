export function requireEnv(args: {
	env: NodeJS.ProcessEnv;
	name: string;
}): string {
	const value = args.env[args.name];
	if (!value) throw new Error(`${args.name} is not set`);
	return value;
}
