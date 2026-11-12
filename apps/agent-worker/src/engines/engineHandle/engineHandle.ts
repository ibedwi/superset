export interface EngineHandle {
	stop(): Promise<void>;
	isRunning(): boolean;
	/** Settles when the engine has stopped; rejects when it fails. */
	readonly closed: Promise<void>;
}
