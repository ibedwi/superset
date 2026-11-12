import { describe, expect, test } from "bun:test";
import {
	hasField,
	numberField,
	prettyJson,
	stringField,
	stringListField,
} from "./stepData";

describe("stepData", () => {
	const output = {
		status: 200,
		body: "[]",
		headerNames: ["Authorization", 3],
		json: null,
	};

	test("reads fields of the expected type only", () => {
		expect(numberField(output, "status")).toBe(200);
		expect(stringField(output, "status")).toBeNull();
		expect(stringField(output, "body")).toBe("[]");
		expect(stringListField(output, "headerNames")).toEqual(["Authorization"]);
	});

	test("tolerates values that are not objects", () => {
		expect(stringField(null, "body")).toBeNull();
		expect(stringField(["body"], "0")).toBeNull();
		expect(hasField("text", "length")).toBe(false);
	});

	test("counts a null field as present", () => {
		expect(hasField(output, "json")).toBe(true);
		expect(hasField(output, "missing")).toBe(false);
	});

	test("prints undefined without throwing", () => {
		expect(prettyJson(undefined)).toBe("undefined");
	});
});
