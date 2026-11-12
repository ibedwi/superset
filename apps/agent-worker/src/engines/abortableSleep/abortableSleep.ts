export function abortableSleep(args: {
	ms: number;
	signal: AbortSignal;
}): Promise<void> {
	return new Promise((resolve) => {
		if (args.signal.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			args.signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, args.ms);
		args.signal.addEventListener("abort", done, { once: true });
	});
}
