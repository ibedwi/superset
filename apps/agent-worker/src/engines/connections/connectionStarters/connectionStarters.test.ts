import { describe, expect, test } from "bun:test";
import type { EngineHandle } from "../../engineHandle";
import { stubActivities } from "../../testing/stubActivities";
import { createConnectionStarters } from "./connectionStarters";

const engine: EngineHandle = {
	closed: new Promise<void>(() => {}),
	isRunning: () => true,
	async stop() {},
};

function setup(args: { allowPrivateHosts: boolean; resolvesTo?: string }) {
	const dialed: string[] = [];
	const starters = createConnectionStarters({
		allowPrivateHosts: args.allowPrivateHosts,
		resolveHost: async () => [args.resolvesTo ?? "93.184.216.34"],
		instanceId: "host-1",
		activities: () => stubActivities(),
		temporalActivities: stubActivities(),
		startInngestEngine: async (deps) => {
			dialed.push(
				`inngest:${deps.client.baseUrl ?? "cloud"}:${deps.instanceId}`,
			);
			return engine;
		},
		startTemporalWorker: async ({ connection }) => {
			dialed.push(`temporal:${connection.address}`);
			return engine;
		},
	});
	return { starters, dialed };
}

const temporal = (address: string) => ({
	id: "c1",
	provider: "temporal" as const,
	updatedAt: "v1",
	address,
	namespace: "ns",
	tls: false,
});

describe("createConnectionStarters", () => {
	test("refuses a Temporal address on a private network without dialing", async () => {
		const { starters, dialed } = setup({
			allowPrivateHosts: false,
			resolvesTo: "10.0.0.5",
		});

		await expect(
			starters.startTemporal(temporal("temporal.internal:7233")),
		).rejects.toThrow(/forbidden/);
		expect(dialed).toEqual([]);
	});

	test("dials a private Temporal address when the override is set", async () => {
		const { starters, dialed } = setup({
			allowPrivateHosts: true,
			resolvesTo: "10.0.0.5",
		});

		await starters.startTemporal(temporal("localhost:7244"));

		expect(dialed).toEqual(["temporal:localhost:7244"]);
	});

	test("refuses a private Inngest base URL without dialing", async () => {
		const { starters, dialed } = setup({
			allowPrivateHosts: false,
			resolvesTo: "127.0.0.1",
		});

		await expect(
			starters.startInngest({
				id: "c2",
				provider: "inngest",
				updatedAt: "v1",
				baseUrl: "http://localhost:8288",
				eventKey: "e",
				signingKey: "s",
			}),
		).rejects.toThrow(/forbidden/);
		expect(dialed).toEqual([]);
	});

	test("gives each Inngest connection its own instance id", async () => {
		const { starters, dialed } = setup({ allowPrivateHosts: false });

		await starters.startInngest({
			id: "abcdef12-0000",
			provider: "inngest",
			updatedAt: "v1",
			eventKey: "e",
			signingKey: "s",
		});

		expect(dialed).toEqual(["inngest:cloud:host-1-abcdef12"]);
	});
});
