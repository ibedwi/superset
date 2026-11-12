import { describe, expect, test } from "bun:test";
import { assertConnectionHostAllowed } from "./connectionHost";

const resolveTo = (addresses: string[]) => async () => addresses;
const temporal = (address: string) => ({
	provider: "temporal" as const,
	address,
});

describe("assertConnectionHostAllowed", () => {
	test("refuses a Temporal address on a private network", async () => {
		await expect(
			assertConnectionHostAllowed({
				connection: temporal("temporal.internal:7233"),
				allowPrivateHosts: false,
				resolveHost: resolveTo(["10.0.0.5"]),
			}),
		).rejects.toThrow(/forbidden/);
	});

	test("refuses a loopback Temporal address with a port", async () => {
		await expect(
			assertConnectionHostAllowed({
				connection: temporal("127.0.0.1:7233"),
				allowPrivateHosts: false,
				resolveHost: resolveTo([]),
			}),
		).rejects.toThrow(/forbidden/);
	});

	test("accepts a private Temporal address when the override is set", async () => {
		await expect(
			assertConnectionHostAllowed({
				connection: temporal("127.0.0.1:7233"),
				allowPrivateHosts: true,
				resolveHost: resolveTo([]),
			}),
		).resolves.toBeUndefined();
	});

	test("accepts a public Temporal address", async () => {
		await expect(
			assertConnectionHostAllowed({
				connection: temporal("temporal.example.com:7233"),
				allowPrivateHosts: false,
				resolveHost: resolveTo(["93.184.216.34"]),
			}),
		).resolves.toBeUndefined();
	});

	test("refuses an Inngest base URL on a private network", async () => {
		await expect(
			assertConnectionHostAllowed({
				connection: { provider: "inngest", baseUrl: "http://localhost:8288" },
				allowPrivateHosts: false,
				resolveHost: resolveTo(["127.0.0.1"]),
			}),
		).rejects.toThrow(/forbidden/);
	});

	test("Inngest Cloud has no address to check", async () => {
		await expect(
			assertConnectionHostAllowed({
				connection: { provider: "inngest" },
				allowPrivateHosts: false,
				resolveHost: resolveTo(["10.0.0.1"]),
			}),
		).resolves.toBeUndefined();
	});
});
