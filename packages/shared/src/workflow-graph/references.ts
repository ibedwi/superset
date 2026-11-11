/**
 * Template references available inside node config strings:
 *
 *   {{nodes.<nodeId>.output.<dot.path>}}
 *   {{trigger.<dot.path>}}
 *   {{run.id}}
 *
 * Resolution is a hand-rolled dot-path walk — no JSONPath library and no
 * eval, because templates resolve inside the deterministic Temporal workflow
 * and the paths are user input.
 */

export type RunContext = {
	runId: string;
	trigger: unknown;
	nodes: Record<string, { output: unknown }>;
};

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_.\-[\]]+)\s*\}\}/g;
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

export function resolvePath(root: unknown, path: string[]): unknown {
	let current = root;
	for (const segment of path) {
		if (current === null || current === undefined) return undefined;
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index)) return undefined;
			current = current[index];
			continue;
		}
		if (typeof current !== "object") return undefined;
		if (!SEGMENT_RE.test(segment)) return undefined;
		// Own properties only: paths are user input and must not reach
		// constructor, __proto__, or anything else inherited.
		if (!Object.hasOwn(current, segment)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

export function resolveReference(
	context: RunContext,
	reference: string,
): unknown {
	const path = reference.split(".");
	const head = path[0];
	if (head === "run" && path[1] === "id" && path.length === 2)
		return context.runId;
	if (head === "trigger") return resolvePath(context.trigger, path.slice(1));
	if (head === "nodes") {
		const nodeId = path[1];
		if (!nodeId) return undefined;
		return resolvePath(context.nodes[nodeId], path.slice(2));
	}
	return undefined;
}

/** Missing references render as "" so a template never fails mid-run. */
export function renderTemplate(context: RunContext, template: string): string {
	return template.replace(TEMPLATE_RE, (_match, reference: string) => {
		const value = resolveReference(context, reference);
		if (value === undefined || value === null) return "";
		if (typeof value === "string") return value;
		return JSON.stringify(value);
	});
}

/** Node ids referenced by a template, for editor autocomplete and validation. */
export function referencedNodeIds(template: string): string[] {
	const ids = new Set<string>();
	for (const match of template.matchAll(TEMPLATE_RE)) {
		const reference = match[1];
		if (!reference) continue;
		const path = reference.split(".");
		if (path[0] === "nodes" && path[1]) ids.add(path[1]);
	}
	return [...ids];
}
