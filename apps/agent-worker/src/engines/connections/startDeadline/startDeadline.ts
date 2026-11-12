import type { EngineHandle } from "../../engineHandle";

/**
 * Fails when an engine does not come up in time, so one unreachable server
 * cannot hold up the other connections. An engine that comes up late is stopped.
 */
export function withStartDeadline(args: {
	start: Promise<EngineHandle>;
	deadlineMs: number;
	message: string;
}): Promise<EngineHandle> {
	return new Promise<EngineHandle>((resolve, reject) => {
		let late = false;
		const timer = setTimeout(() => {
			late = true;
			reject(new Error(args.message));
		}, args.deadlineMs);
		args.start.then(
			(handle) => {
				clearTimeout(timer);
				if (late) void handle.stop().catch(() => {});
				else resolve(handle);
			},
			(error: unknown) => {
				clearTimeout(timer);
				if (!late) reject(error);
			},
		);
	});
}
