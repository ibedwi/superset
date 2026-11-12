import { describe, expect, test } from "bun:test";
import type { TemporalEngineConnection } from "./connection";
import { temporalConnectOptions } from "./temporalConnectOptions";

const base: TemporalEngineConnection = {
	id: "c1",
	provider: "temporal",
	updatedAt: "1",
	address: "temporal.example.com:7233",
	namespace: "ns",
	tls: false,
};

describe("temporalConnectOptions", () => {
	test("a plain server gets no TLS", () => {
		expect(temporalConnectOptions(base)).toEqual({
			address: "temporal.example.com:7233",
			tls: false,
		});
	});

	test("an API key keeps simple TLS and passes the key", () => {
		expect(
			temporalConnectOptions({ ...base, tls: true, apiKey: "key-1234" }),
		).toEqual({
			address: "temporal.example.com:7233",
			tls: true,
			apiKey: "key-1234",
		});
	});

	test("a client certificate becomes a cert pair", () => {
		const options = temporalConnectOptions({
			...base,
			tls: true,
			clientCertPem: "CERT",
			clientKeyPem: "KEY",
		});
		expect(options.tls).toEqual({
			clientCertPair: { crt: Buffer.from("CERT"), key: Buffer.from("KEY") },
		});
	});

	test("a custom CA and server name are passed to TLS", () => {
		const options = temporalConnectOptions({
			...base,
			tls: true,
			serverRootCaPem: "CA",
			serverName: "temporal.internal",
		});
		expect(options.tls).toEqual({
			serverNameOverride: "temporal.internal",
			serverRootCACertificate: Buffer.from("CA"),
		});
	});
});
