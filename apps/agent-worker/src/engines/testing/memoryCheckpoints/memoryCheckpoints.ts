import type { JournalApi } from "../../journal/journaledContext";

export function createMemoryCheckpoints(): JournalApi & {
	rows: Map<string, Map<string, unknown>>;
	saves: Array<{ runId: string; key: string }>;
} {
	const rows = new Map<string, Map<string, unknown>>();
	const saves: Array<{ runId: string; key: string }> = [];
	return {
		rows,
		saves,
		async loadCheckpoints({ runId }) {
			return [...(rows.get(runId) ?? [])].map(([key, result]) => ({
				key,
				result,
			}));
		},
		async saveCheckpoint({ runId, key, result }) {
			const run = rows.get(runId) ?? new Map<string, unknown>();
			if (!run.has(key)) run.set(key, result);
			rows.set(runId, run);
			saves.push({ runId, key });
			return { saved: true };
		},
	};
}
