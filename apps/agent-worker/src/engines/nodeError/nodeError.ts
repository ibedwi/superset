export class NodeError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly timedOut: boolean;

	constructor(args: {
		message: string;
		code: string;
		retryable: boolean;
		timedOut?: boolean;
	}) {
		super(args.message);
		this.name = "NodeError";
		this.code = args.code;
		this.retryable = args.retryable;
		this.timedOut = args.timedOut ?? false;
	}
}
