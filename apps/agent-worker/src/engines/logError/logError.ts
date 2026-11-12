export function logError(args: { message: string; error: unknown }): void {
	const detail =
		args.error instanceof Error ? args.error.message : String(args.error);
	console.error(`${args.message}: ${detail}`);
}
