import { expect, test } from "bun:test";
import {
	LAYOUT_RANK_GAP,
	LAYOUT_SIBLING_GAP,
	layoutWorkflowGraph,
} from "./layout";

const node = (id: string) => ({ id, position: { x: 7, y: 7 } });
const positions = (graph: ReturnType<typeof layoutWorkflowGraph>) =>
	Object.fromEntries(graph.nodes.map((n) => [n.id, n.position]));

test("places a chain top to bottom in one column", () => {
	const graph = layoutWorkflowGraph({
		nodes: [node("c"), node("a"), node("b")],
		edges: [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
		],
	});
	expect(positions(graph)).toEqual({
		a: { x: 0, y: 0 },
		b: { x: 0, y: LAYOUT_RANK_GAP },
		c: { x: 0, y: 2 * LAYOUT_RANK_GAP },
	});
});

test("puts siblings side by side and a join below its longest input", () => {
	const graph = layoutWorkflowGraph({
		nodes: [node("t"), node("left"), node("right"), node("deep"), node("join")],
		edges: [
			{ source: "t", target: "left" },
			{ source: "t", target: "right" },
			{ source: "right", target: "deep" },
			{ source: "left", target: "join" },
			{ source: "deep", target: "join" },
		],
	});
	const at = positions(graph);
	expect(at.left).toEqual({ x: -LAYOUT_SIBLING_GAP / 2, y: LAYOUT_RANK_GAP });
	expect(at.right).toEqual({ x: LAYOUT_SIBLING_GAP / 2, y: LAYOUT_RANK_GAP });
	expect(at.join?.y).toBe(3 * LAYOUT_RANK_GAP);
});

test("puts a condition's true branch left of its false branch", () => {
	const graph = layoutWorkflowGraph({
		nodes: [node("check"), node("no"), node("yes")],
		edges: [
			{ source: "check", target: "no", sourceHandle: "false" },
			{ source: "check", target: "yes", sourceHandle: "true" },
		],
	});
	const at = positions(graph);
	expect(at.yes?.x).toBeLessThan(at.no?.x ?? 0);
});

test("keeps nodes on a cycle visible in a rank after the rest", () => {
	const graph = layoutWorkflowGraph({
		nodes: [node("t"), node("x"), node("y")],
		edges: [
			{ source: "x", target: "y" },
			{ source: "y", target: "x" },
		],
	});
	const at = positions(graph);
	expect(at.t).toEqual({ x: 0, y: 0 });
	expect(at.x?.y).toBe(LAYOUT_RANK_GAP);
	expect(at.y?.y).toBe(LAYOUT_RANK_GAP);
});
