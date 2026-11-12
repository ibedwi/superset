export class RunCanceledError extends Error {
	constructor() {
		super("Run canceled");
		this.name = "RunCanceledError";
	}
}
