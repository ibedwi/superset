export const MINUTE_MS = 60_000;

export const MAX_AGENT_MINUTES = 240;
export const MAX_CLI_MINUTES = 120;
export const MAX_HTTP_SECONDS = 300;
export const MAX_CLI_TAIL = 64 * 1024;

export const QUICK = { timeoutMs: 30_000, attempts: 10 };
/** Dispatch starts a workspace and an agent; a retry would start a second one. */
export const DISPATCH = { timeoutMs: 3 * MINUTE_MS, attempts: 1 };
export const CAPTURE = { timeoutMs: 2 * MINUTE_MS, attempts: 5 };
export const LLM = { timeoutMs: 5 * MINUTE_MS, attempts: 3 };
export const HTTP_ATTEMPTS = 3;

export const POLL_ATTEMPTS = 10;
export const POLL_SLACK_MS = MINUTE_MS;
