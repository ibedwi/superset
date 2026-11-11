import { describe, expect, test } from "bun:test";
import { assertPublicUrl, isForbiddenAddress } from "./ssrf";

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
		for (const address of ["93.184.216.34", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"]) {
			expect(isForbiddenAddress(address)).toBe(false);
		}
	});
});

describe("assertPublicUrl", () => {
	test("accepts a public host", async () => {
		const url = await assertPublicUrl(
			"https://api.example.com/x",
			resolveTo(["93.184.216.34"]),
		);
		expect(url.hostname).toBe("api.example.com");
	});

	test("rejects a host resolving to a private address", async () => {
		await expect(
			assertPublicUrl("https://internal.example.com", resolveTo(["10.0.0.5"])),
		).rejects.toThrow(/forbidden/);
	});

	test("rejects literal private IPs and non-http protocols", async () => {
		await expect(
			assertPublicUrl("http://169.254.169.254/latest", resolveTo([])),
		).rejects.toThrow(/forbidden/);
		await expect(
			assertPublicUrl("file:///etc/passwd", resolveTo([])),
		).rejects.toThrow(/protocol/);
	});
});
