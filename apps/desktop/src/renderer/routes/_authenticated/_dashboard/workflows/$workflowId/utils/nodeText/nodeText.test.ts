import { describe, expect, test } from "bun:test";
import {
	conditionLeaf,
	describeRef,
	httpEndpointParts,
	refNodeId,
} from "./nodeText";

const names: Record<string, string> = { "fetch-repo": "Fetch repo" };
const nodeName = (id: string) => names[id];

describe("describeRef", () => {
	test("names the node and the last output field", () => {
		expect(
			describeRef("nodes.fetch-repo.output.json.stargazers_count", nodeName),
		).toBe("Fetch repo · stargazers count");
	});

	test("falls back to the node id when the node is unknown", () => {
		expect(describeRef("nodes.gone.output.text", nodeName)).toBe("gone · text");
	});

	test("names the node alone when no field is chosen yet", () => {
		expect(describeRef("nodes.fetch-repo.output.", nodeName)).toBe(
			"Fetch repo",
		);
	});

	test("keeps an unrecognized path as written", () => {
		expect(describeRef("something.else", nodeName)).toBe("something.else");
	});
});

test("refNodeId reads the node id from a node reference", () => {
	expect(refNodeId("nodes.fetch-repo.output.text")).toBe("fetch-repo");
	expect(refNodeId("trigger.payload")).toBeNull();
});

test("conditionLeaf ignores all/any groups", () => {
	const leaf = { left: { ref: "run.id" }, op: "exists" as const };
	expect(conditionLeaf({ expression: leaf })).toBe(leaf);
	expect(conditionLeaf({ expression: { all: [leaf] } })).toBeNull();
	expect(conditionLeaf({})).toBeNull();
});

test("httpEndpointParts splits host and path, and rejects a partial url", () => {
	expect(
		httpEndpointParts("https://hooks.example.com/workflow/events?x=1"),
	).toEqual({ host: "hooks.example.com", path: "/workflow/events?x=1" });
	expect(httpEndpointParts("hooks.example")).toBeNull();
});
