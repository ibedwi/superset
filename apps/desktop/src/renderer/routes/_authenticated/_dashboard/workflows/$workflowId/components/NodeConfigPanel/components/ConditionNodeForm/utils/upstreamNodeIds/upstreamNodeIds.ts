/** Every node with a path into `nodeId`; only their outputs exist when it runs. */
export function upstreamNodeIds(
	nodeId: string,
	edges: readonly { source: string; target: string }[],
): Set<string> {
	const upstream = new Set<string>();
	const queue = [nodeId];
	for (let current = queue.pop(); current; current = queue.pop()) {
		for (const edge of edges) {
			if (edge.target === current && !upstream.has(edge.source)) {
				upstream.add(edge.source);
				queue.push(edge.source);
			}
		}
	}
	upstream.delete(nodeId);
	return upstream;
}
