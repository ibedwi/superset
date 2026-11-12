import { describe, expect, test } from "bun:test";
import {
	assertPublicHost,
	assertPublicUrl,
	hostFromAddress,
	isForbiddenAddress,
} from "./ssrf";

const resolveTo = (addresses: string[]) => async () => addresses;

describe("isForbiddenAddress", () => {
	test("denies loopback, private, link-local, and metadata ranges", () => {
		for (const address of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254",
			"0.0.0.0",
			"100.100.1.1",
			"224.0.0.1",
			"::1",
			"fe80::1",
			"fd00::2",
			"::ffff:10.0.0.1",
		]) {
			expect(isForbiddenAddress(address)).toBe(true);
		}
	});

	test("allows public addresses", () => {
		for (const address of [
			"93.184.216.34",
			"172.32.0.1",
			"2606:2800:220:1:248:1893:25c8:1946",
		]) {
			expect(isForbiddenAddress(address)).toBe(false);
		}
	});
});

describe("assertPublicUrl", () => {
	test("accepts a public host", async () => {
		const url = await assertPublicUrl({
			url: "https://api.example.com/x",
			resolveHost: resolveTo(["93.184.216.34"]),
		});
		expect(url.hostname).toBe("api.example.com");
	});

	test("rejects a host resolving to a private address", async () => {
		await expect(
			assertPublicUrl({
				url: "https://internal.example.com",
				resolveHost: resolveTo(["10.0.0.5"]),
			}),
		).rejects.toThrow(/forbidden/);
	});

	test("rejects literal private IPs and non-http protocols", async () => {
		await expect(
			assertPublicUrl({
				url: "http://169.254.169.254/latest",
				resolveHost: resolveTo([]),
			}),
		).rejects.toThrow(/forbidden/);
		await expect(
			assertPublicUrl({
				url: "file:///etc/passwd",
				resolveHost: resolveTo([]),
			}),
		).rejects.toThrow(/protocol/);
	});
});

describe("assertPublicHost", () => {
	test("accepts a host that resolves to a public address", async () => {
		await expect(
			assertPublicHost({
				host: "temporal.example.com",
				resolveHost: resolveTo(["93.184.216.34"]),
			}),
		).resolves.toBeUndefined();
	});

	test("rejects a host that resolves to a private address", async () => {
		await expect(
			assertPublicHost({
				host: "temporal.internal",
				resolveHost: resolveTo(["10.0.0.5"]),
			}),
		).rejects.toThrow(/forbidden/);
	});

	test("rejects a literal loopback address without resolving", async () => {
		await expect(
			assertPublicHost({ host: "127.0.0.1", resolveHost: resolveTo([]) }),
		).rejects.toThrow(/forbidden/);
	});

	test("rejects a host that does not resolve", async () => {
		await expect(
			assertPublicHost({
				host: "nope.example.com",
				resolveHost: resolveTo([]),
			}),
		).rejects.toThrow(/Could not resolve/);
	});
});

describe("hostFromAddress", () => {
	test("strips the port from a host", () => {
		expect(hostFromAddress("temporal.example.com:7233")).toBe(
			"temporal.example.com",
		);
	});

	test("keeps a host without a port", () => {
		expect(hostFromAddress("temporal.example.com")).toBe(
			"temporal.example.com",
		);
	});

	test("unwraps a bracketed IPv6 address with a port", () => {
		expect(hostFromAddress("[::1]:7233")).toBe("::1");
	});

	test("keeps a bare IPv6 address", () => {
		expect(hostFromAddress("fd00::2")).toBe("fd00::2");
	});
});
