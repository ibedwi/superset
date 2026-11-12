import { describe, expect, it } from "bun:test";
import {
	buildTemporalConnectInput,
	EMPTY_TEMPORAL_FORM,
	type TemporalFormState,
	temporalFormIssue,
} from "./temporalConnectInput";

const base: TemporalFormState = {
	...EMPTY_TEMPORAL_FORM,
	address: " acme.tmprl.cloud:7233 ",
	namespace: " acme.abc12 ",
	apiKey: " key ",
};
const pem = "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----";

describe("buildTemporalConnectInput", () => {
	it("sends only the API key for API key authentication", () => {
		expect(buildTemporalConnectInput({ ...base, clientCertPem: pem })).toEqual({
			provider: "temporal",
			address: "acme.tmprl.cloud:7233",
			namespace: "acme.abc12",
			tls: true,
			apiKey: "key",
		});
	});

	it("sends the certificate pair and an optional CA for client certificates", () => {
		const input = buildTemporalConnectInput({
			...base,
			authentication: "client_certificate",
			clientCertPem: pem,
			clientKeyPem: pem,
			serverRootCaPem: " ",
		});
		expect(input).toMatchObject({ clientCertPem: pem, clientKeyPem: pem });
		expect(input).not.toHaveProperty("apiKey");
		expect(input).not.toHaveProperty("serverRootCaPem");
	});

	it("forces TLS on for authenticated connections and follows the switch for none", () => {
		expect(buildTemporalConnectInput({ ...base, tls: false }).tls).toBe(true);
		const none = { ...base, authentication: "none" as const };
		expect(buildTemporalConnectInput({ ...none, tls: false }).tls).toBe(false);
		expect(buildTemporalConnectInput({ ...none, tls: true }).tls).toBe(true);
	});
});

describe("temporalFormIssue", () => {
	it("rejects an address with a scheme", () => {
		expect(temporalFormIssue({ ...base, address: "https://host:7233" })).toBe(
			"address",
		);
	});

	it("requires the secret of the chosen authentication", () => {
		expect(temporalFormIssue({ ...base, apiKey: "" })).toBe("apiKey");
		expect(
			temporalFormIssue({ ...base, authentication: "client_certificate" }),
		).toBe("clientCertPem");
		expect(
			temporalFormIssue({
				...base,
				authentication: "client_certificate",
				clientCertPem: pem,
				clientKeyPem: "nope",
			}),
		).toBe("clientKeyPem");
	});

	it("rejects a server name without TLS", () => {
		expect(
			temporalFormIssue({
				...base,
				authentication: "none",
				tls: false,
				serverName: "x",
			}),
		).toBe("serverNameNeedsTls");
	});

	it("accepts a complete form", () => {
		expect(temporalFormIssue(base)).toBeNull();
	});
});
