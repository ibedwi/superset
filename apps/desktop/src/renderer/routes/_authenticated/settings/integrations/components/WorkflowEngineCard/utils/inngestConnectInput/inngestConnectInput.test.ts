import { describe, expect, it } from "bun:test";
import {
	buildInngestConnectInput,
	EMPTY_INNGEST_FORM,
	inngestFormIssue,
} from "./inngestConnectInput";

const filled = { eventKey: " ek ", signingKey: " sk ", baseUrl: "" };

describe("buildInngestConnectInput", () => {
	it("trims keys and omits an empty base URL", () => {
		expect(buildInngestConnectInput(filled)).toEqual({
			provider: "inngest",
			eventKey: "ek",
			signingKey: "sk",
		});
	});

	it("keeps a self-hosted base URL", () => {
		expect(
			buildInngestConnectInput({
				...filled,
				baseUrl: " https://inngest.acme.dev ",
			}),
		).toMatchObject({ baseUrl: "https://inngest.acme.dev" });
	});
});

describe("inngestFormIssue", () => {
	it("asks for the keys first", () => {
		expect(inngestFormIssue(EMPTY_INNGEST_FORM)).toBe("eventKey");
		expect(inngestFormIssue({ ...filled, signingKey: " " })).toBe("signingKey");
	});

	it("rejects a base URL that is not a URL", () => {
		expect(inngestFormIssue({ ...filled, baseUrl: "not a url" })).toBe(
			"baseUrl",
		);
	});

	it("accepts a complete form", () => {
		expect(inngestFormIssue(filled)).toBeNull();
	});
});
